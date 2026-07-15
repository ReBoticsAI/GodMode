/** Version of the stable kernel client contract exposed to Bridge and web plugins. */
export const KERNEL_CLIENT_API_VERSION = 1 as const;

export type KernelClientApiVersion = typeof KERNEL_CLIENT_API_VERSION;
