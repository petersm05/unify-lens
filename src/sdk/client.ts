import {
  configFromUnifyEnvironment,
  sdkFactory,
  TokenTypes,
  type Config,
  type KnowledgeGraphClientInterface,
  type MetaModel,
} from '@bizzdesign/sdk-bundle/browser';

import { SampleStore } from '../data/sample-store';
import { loadRuntimeConfig, type RuntimeConfig, settingsFromEnvJs } from './runtime-config';

export type Sdk = ReturnType<typeof sdkFactory>;
export type Kg = KnowledgeGraphClientInterface<MetaModel>;

export interface Session {
  readonly sdk: Sdk;
  readonly kg: Kg;
  /** Shared population reads, so each attribute is not fetched separately. */
  readonly sample: SampleStore;
  readonly metaModel: MetaModel;
  /** Whatever identifies the backend in the UI — hosted environment or sandbox API host. */
  readonly label: string;
}

const LOG_SETTINGS = {
  minimumLogLevel: import.meta.env.DEV ? 'warn' : 'error',
} as const satisfies Config['logSettings'];

// The by-type breakdown issues one count query per object type. Batching folds
// that whole fan-out into a single HTTP request.
const QUERY_BATCHING = {
  enabled: true,
  batchMaxRequests: 16,
  batchInterval: 40,
} as const satisfies Config['queryBatching'];

let pending: Promise<Session> | null = null;

/**
 * Connects to Unify and returns an authenticated session.
 *
 * Safe to call from anywhere — the bootstrap runs at most once per page load.
 */
export function connect(): Promise<Session> {
  pending ??= bootstrap();
  return pending;
}

async function bootstrap(): Promise<Session> {
  const config = await loadRuntimeConfig();
  if (!config) throw new MissingEnvironment();

  const metaModel = (config.metaModel ?? 'BDCore') as MetaModel;
  const { sdkConfig, label } = await resolveConfig(config);

  const sdk = sdkFactory(sdkConfig);

  // Completes the authorization-code exchange on the way back from Cognito,
  // refreshes an expired token, or redirects to login when there is no session.
  // Also runs the one-time schema-version compatibility check.
  await sdk.ensureAuthenticated();

  const kg = sdk.knowledgeGraphClient(metaModel);
  return { sdk, kg, sample: new SampleStore(kg), metaModel, label };
}

/** Thrown when nothing tells the app which Unify instance to talk to. */
export class MissingEnvironment extends Error {
  constructor() {
    super('No Unify environment configured.');
    this.name = 'MissingEnvironment';
  }
}

/**
 * Builds the SDK config in whichever mode the deployment supports.
 *
 * Hosted `*.unify.cloud` environments publish an `env.js` the SDK can read, so
 * only the root URL is needed. Sandbox and per-developer stacks do not, so the
 * AppSync and Cognito settings are supplied directly.
 */
async function resolveConfig(
  config: RuntimeConfig,
): Promise<{ sdkConfig: Config; label: string }> {
  const callbackUrl = config.callbackUrl ?? defaultCallbackUrl();

  if (config.environmentUrl) {
    // Preferred: read env.js as a script, which works from any origin. Falls
    // back to the SDK's fetch-based reader, which only succeeds when the app is
    // hosted on the tenant itself.
    const viaScript = await settingsFromEnvJs(config.environmentUrl);
    if (viaScript?.graphqlEndpoint) {
      return {
        label: new URL(config.environmentUrl).hostname,
        sdkConfig: buildSdkConfig(viaScript, callbackUrl),
      };
    }

    const sdkConfig = await configFromUnifyEnvironment(config.environmentUrl, {
      // Cognito redirects back here after login. This exact URL must be on the
      // app client's callback allowlist — an administrator adds it. Without it
      // the flow dies with a redirect-mismatch error.
      callbackUrl,
      useTokenType: TokenTypes.ACCESS_TOKEN,
      logSettings: LOG_SETTINGS,
      queryBatching: QUERY_BATCHING,
    });
    return { sdkConfig, label: new URL(config.environmentUrl).hostname };
  }

  const graphqlEndpoint = required(config.graphqlEndpoint, 'graphqlEndpoint');

  return {
    label: new URL(graphqlEndpoint).hostname,
    sdkConfig: buildSdkConfig(config, callbackUrl),
  };
}

/**
 * Where Cognito should return after login, when a deployment does not say.
 *
 * At the root of a host this is the bare origin — the form already registered
 * for `localhost` and for tenant-hosted deployments, and changing it would
 * invalidate those allowlist entries, since Cognito matches the redirect URI as
 * an exact string. Under a sub-path the app is not at the origin, so the path
 * has to be included, trailing slash and all.
 */
function defaultCallbackUrl(): string {
  const base = new URL(document.baseURI);
  return base.pathname === '/' ? base.origin : base.origin + base.pathname;
}

/** The SDK config for a set of settings, however they were discovered. */
function buildSdkConfig(config: RuntimeConfig, callbackUrl: string): Config {
  return {
    graphqlEndpoint: required(config.graphqlEndpoint, 'graphqlEndpoint'),
    graphqlRealtimeEndpoint: required(config.graphqlRealtimeEndpoint, 'graphqlRealtimeEndpoint'),
    authentication: {
      type: 'cognito-user',
      cognito: {
        region: required(config.cognitoRegion, 'cognitoRegion'),
        endpoint: required(config.cognitoDomain, 'cognitoDomain'),
        callbackUrl,
        userPoolId: required(config.cognitoUserPoolId, 'cognitoUserPoolId'),
        clientId: required(config.cognitoClientId, 'cognitoClientId'),
      },
    },
    useTokenType: TokenTypes.ACCESS_TOKEN,
    logSettings: LOG_SETTINGS,
    queryBatching: QUERY_BATCHING,
  };
}

function required(value: string | undefined, field: string): string {
  if (value === undefined) {
    throw new Error(
      `${field} is missing. Set environmentUrl for a hosted environment, or the full graphql/cognito group for a sandbox.`,
    );
  }
  return value;
}

/** Every `BaseError` the SDK raises internally, including ones it recovered from. */
export function onSdkError(session: Session, handler: (message: string) => void): void {
  session.sdk.errorClient.errors$.subscribe((error) => {
    handler(error.message);
  });
}

