import { API } from "@main/preload"
import { ColimaCreateOptions } from "../api/colima"

declare global {
    interface Window {api: typeof API}
}

// Re-export ColimaCreateOptions for use in renderer
export { ColimaCreateOptions };

/* TODO: Remove after running `npm i --save-dev @types/dockerode` */
declare module 'dockerode';