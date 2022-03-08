export interface APIInterface {
    onUpdateStatus: (callback: CallableFunction) => () => void,
}

declare global {
    interface Window {
        api: APIInterface
    }
}