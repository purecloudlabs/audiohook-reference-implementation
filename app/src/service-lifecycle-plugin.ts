import { FastifyInstance, FastifyRequest } from 'fastify';
import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

export type ServiceState = 'INITIALIZING' | 'RUNNING' | 'DRAINING' | 'CLOSING' | 'EXITING' | 'ERROR';

export type EvacuationListener = () => void;

export interface SessionReference {
    unregister(): void;
}

export interface ServiceLifecyle {
    readonly state: ServiceState;
    registerSession(evacuate?: EvacuationListener): SessionReference;
}

declare module 'fastify' {
    interface FastifyInstance {
        lifecycle: ServiceLifecyle
    }
}
  
export type OnNewHealthCheckClientHandler = (remoteIp: string, request: FastifyRequest) => void;

export interface ServiceLifecycleOptions {
    onNewHealthCheckClient?: OnNewHealthCheckClientHandler;
}

class SessionReferenceImpl implements SessionReference {
    owner: ServiceLifecyleImpl | null;
    evacuate?: EvacuationListener;

    constructor(owner: ServiceLifecyleImpl, evacuate?: EvacuationListener) {
        this.owner = owner;
        this.evacuate = evacuate;
    }

    unregister(): void {
        if(this.owner) {
            const tmp = this.owner;
            this.owner = null;
            tmp.removeSession(this);
        }
    }
}


type HealthCheckRemoteInfo = {
    addr: string;
    tsFirst: number;
    tsLast: number;
    count: number;
};

class ServiceLifecyleImpl implements ServiceLifecyle {
    fastify: FastifyInstance;
    options: ServiceLifecycleOptions;
    state: ServiceState = 'INITIALIZING';
    sessions = new Set<SessionReferenceImpl>();
    healthCheckStats = new Map<string, HealthCheckRemoteInfo>();

    constructor(fastify: FastifyInstance, options: ServiceLifecycleOptions) {
        this.fastify = fastify;
        this.options = options;
    }

    registerSession(evacuate?: EvacuationListener): SessionReference {

        const ref = new SessionReferenceImpl(this, evacuate);

        this.sessions.add(ref);
        return ref;
    }

    removeSession(ref: SessionReferenceImpl): void {
        this.sessions.delete(ref);
        if((this.sessions.size === 0) && (this.state === 'DRAINING')) {
            this.fastify.log.warn('All sessions drained, initiating exit.');
            this._closeAndExit();
        }
    }

    handleHealthCheck(request: FastifyRequest): boolean {
        if(this.state === 'EXITING') {
            return false;
        }
        const now = Date.now();
        const remoteIp = request.socket.remoteAddress;
        if (remoteIp) {
            const item = this.healthCheckStats.get(remoteIp);
            if (!item) {
                this.fastify.log.info(`First health check from new source. RemoteAddr: ${remoteIp}, URI: <${request.url}>, Headers: ${JSON.stringify(request.headers)}`);
                this.healthCheckStats.set(remoteIp, { addr: remoteIp, tsFirst: now, tsLast: now, count: 1 });
                this.options.onNewHealthCheckClient?.(remoteIp, request);
            } else {
                item.tsLast = now;
                ++item.count;
            }
        }
        return this.state === 'RUNNING';
    }

    drainAndClose(reason: string): void {
        this.fastify.log.warn(`Initiating shutdown of service. Reason: ${reason}`);
        if (this.sessions.size > 0) {
            if(this.state !== 'DRAINING') {
                this.fastify.log.info(`Service has active ${this.sessions.size} sessions, draining...`);
                this.state = 'DRAINING';
                for(const session of this.sessions) {
                    session.evacuate?.();
                }
            }

        } else {
            this.fastify.log.info('No session active, no need to drain.');
            this._closeAndExit();
        }
    }

    _closeAndExit(): void {
        if(this.state === 'INITIALIZING') {
            this._exitNow();
        } else if(this.state !== 'EXITING') {
            this.state = 'CLOSING';
            this.fastify.close(() => this._exitNow());
        }
    }

    _exitNow(): void {
        this.state = 'EXITING';
        setImmediate(() => {
            console.log('***** EXITING NOW!!! *****');
            process.exit(0);
        });
    }
}


const serviceLifecyclePlugin: FastifyPluginAsync<ServiceLifecycleOptions> = async (fastify, options) => {

    const lifecycle = new ServiceLifecyleImpl(fastify, options);

    fastify.decorate<FastifyInstance['lifecycle']>('lifecycle', lifecycle);

    fastify.get('/health/check', { logLevel: 'warn' }, (request, reply) => {
        const isHealthy = lifecycle.handleHealthCheck(request);
        const status = isHealthy ? 200 : 503;
        reply
            .code(status)
            .header('Cache-Control', 'max-age=0, no-cache, no-store, must-revalidate, proxy-revalidate')
            .send({ 'Http-Status': status, 'Healthy': isHealthy });
    });

    process.once('SIGTERM', () => lifecycle.drainAndClose('SIGTERM'));
    process.once('SIGINT', () => lifecycle.drainAndClose('SIGINT'));
    process.once('SIGQUIT', () => lifecycle.drainAndClose('SIGQUIT'));
    process.once('SIGSTP', () => lifecycle.drainAndClose('SIGSTP'));

    fastify.ready((err) => {
        if(err) {
            lifecycle.state = 'ERROR';
            // TODO: Force exit on error or let listen() invoker do that?
        } else {
            fastify.log.info('Service is ready, set RUNNING state');
            lifecycle.state = 'RUNNING';
        }
    });
};


export default fp(serviceLifecyclePlugin, {
    fastify: '4.x',
    name: 'service-lifecycle'
});
