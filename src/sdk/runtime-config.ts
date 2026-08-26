/**
 * Where the app learns which Unify instance to talk to.
 *
 * Build-time `VITE_*` variables bake the tenant into the bundle, which means a
 * separate build per customer. A file fetched at start-up keeps one artifact
 * deployable anywhere: drop a different `config.json` beside it and the same
 * bundle points somewhere else.
 *
 * Resolution order, first hit wins:
 *   1. `config.json` next to the app — how a deployment is configured.
 *   2. `VITE_*` build variables — how local development is configured.
 *   3. A choice saved on this device — how someone using a shared static host
 *      configures it for themselves, once.
 */
export interface RuntimeConfig {
  /** Root of a hosted environment; its `env.js` supplies everything else. */
  readonly environmentUrl?: string;
  /** Or the settings directly, for a stack that publishes no `env.js`. */
  readonly graphqlEndpoint?: string;
  readonly graphqlRealtimeEndpoint?: string;
  readonly cognitoRegion?: string;
  readonly cognitoDomain?: string;
  readonly cognitoUserPoolId?: string;
  readonly cognitoClientId?: string;
  readonly metaModel?: string;
  /** Overrides the OAuth redirect; defaults to this app's own origin. */
  readonly callbackUrl?: string;
}

const SAVED_KEY = 'unify-lens:environment';

export async function loadRuntimeConfig(): Promise<RuntimeConfig | null> {
  const fromFile = await fetchConfig();
  if (fromFile && hasTarget(fromFile)) return fromFile;

  const fromBuild = buildConfig();
  if (hasTarget(fromBuild)) return fromBuild;

  const saved = readSaved();
  if (saved) return { environmentUrl: saved };

  return null;
}

/** Records the environment someone entered on the setup screen. */
export function rememberEnvironment(url: string): void {
  try {
    globalThis.localStorage?.setItem(SAVED_KEY, url);
  } catch {
    // Private browsing or a full store: they will be asked again next time.
  }
}

export function forgetEnvironment(): void {
  try {
    globalThis.localStorage?.removeItem(SAVED_KEY);
  } catch {
    // Nothing to do; the value simply stays.
  }
}

/**
 * Reads a hosted tenant's `env.js` from another origin.
 *
 * That file is served without `access-control-allow-origin`, so `fetch` — and
 * therefore the SDK's own `configFromUnifyEnvironment()` — can only read it
 * when the app is hosted on the tenant itself. A `<script>` tag is not subject
 * to CORS, and the file's only side effect is assigning `globalThis.envConfig`,
 * so loading it as what it is lets one public build serve any tenant.
 *
 * Note this executes code from the environment being connected to. That is the
 * same trust the main Unify app extends to its own `env.js`.
 */
export async function settingsFromEnvJs(environmentUrl: string): Promise<RuntimeConfig | null> {
  let src: string;
  try {
    src = new URL('env.js', `${new URL(environmentUrl).origin}/`).href;
  } catch {
    return null;
  }

  const loaded = await new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = src;
    // A failure here is normal: a sandbox stack publishes no env.js at all.
    script.addEventListener('load', () => resolve(true), { once: true });
    script.addEventListener('error', () => resolve(false), { once: true });
    document.head.append(script);
  });
  if (!loaded) return null;

  const env = (globalThis as { envConfig?: Record<string, unknown> }).envConfig;
  if (!env) return null;

  const text = (key: string): string | undefined => {
    const value = env[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  const graphqlEndpoint = text('appSyncUrl');
  if (!graphqlEndpoint) return null;

  return {
    graphqlEndpoint,
    ...(text('appSyncRealtimeUrl') ? { graphqlRealtimeEndpoint: text('appSyncRealtimeUrl') } : {}),
    ...(text('cognitoRegion') ? { cognitoRegion: text('cognitoRegion') } : {}),
    ...(text('cognitoDomain') ? { cognitoDomain: text('cognitoDomain') } : {}),
    ...(text('cognitoUserPoolId') ? { cognitoUserPoolId: text('cognitoUserPoolId') } : {}),
    ...(text('cognitoClientId') ? { cognitoClientId: text('cognitoClientId') } : {}),
  };
}

function readSaved(): string | null {
  try {
    return globalThis.localStorage?.getItem(SAVED_KEY) ?? null;
  } catch {
    return null;
  }
}

function hasTarget(config: RuntimeConfig | null): config is RuntimeConfig {
  return Boolean(config && (config.environmentUrl ?? config.graphqlEndpoint));
}

/**
 * Fetched relative to the document so the app works under a sub-path, and
 * cache-busted because a deployment's whole configuration lives in this file.
 */
async function fetchConfig(): Promise<RuntimeConfig | null> {
  try {
    const response = await fetch(new URL('config.json', document.baseURI), { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as RuntimeConfig;
  } catch {
    return null;
  }
}

function buildConfig(): RuntimeConfig {
  const read = (key: string): string | undefined => {
    const value = import.meta.env[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  return {
    ...(read('VITE_UNIFY_ENVIRONMENT_URL')
      ? { environmentUrl: read('VITE_UNIFY_ENVIRONMENT_URL') }
      : {}),
    ...(read('VITE_UNIFY_GRAPHQL_URL') ? { graphqlEndpoint: read('VITE_UNIFY_GRAPHQL_URL') } : {}),
    ...(read('VITE_UNIFY_GRAPHQL_REALTIME_URL')
      ? { graphqlRealtimeEndpoint: read('VITE_UNIFY_GRAPHQL_REALTIME_URL') }
      : {}),
    ...(read('VITE_COGNITO_REGION') ? { cognitoRegion: read('VITE_COGNITO_REGION') } : {}),
    ...(read('VITE_COGNITO_DOMAIN') ? { cognitoDomain: read('VITE_COGNITO_DOMAIN') } : {}),
    ...(read('VITE_COGNITO_USER_POOL_ID')
      ? { cognitoUserPoolId: read('VITE_COGNITO_USER_POOL_ID') }
      : {}),
    ...(read('VITE_COGNITO_CLIENT_ID') ? { cognitoClientId: read('VITE_COGNITO_CLIENT_ID') } : {}),
    ...(read('VITE_UNIFY_METAMODEL') ? { metaModel: read('VITE_UNIFY_METAMODEL') } : {}),
    ...(read('VITE_UNIFY_CALLBACK_URL') ? { callbackUrl: read('VITE_UNIFY_CALLBACK_URL') } : {}),
  };
}
