import { API } from "@main/preload"

declare global {
    interface Window {api: typeof API}
}

/* TODO: Remove after running `npm i --save-dev @types/dockerode` */
declare module 'dockerode';