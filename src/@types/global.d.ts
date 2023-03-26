import API from '@src/preload'
import CONFIG from '@src/config'

declare global {
    interface Window {
        api: typeof API
        config: typeof CONFIG
    }
}

/* TODO: Remove after running `npm i --save-dev @types/dockerode` */
declare module 'dockerode';