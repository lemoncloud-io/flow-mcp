import type { FlowApiConfig } from '../config';

export interface AuthEndpoints {
    /** Social OAuth gateway that drives Google federation (hosts /oauth/google/authorize). */
    socialOAuthUrl: string;
    /** OAuth API base for the code→token exchange (/oauth/google/token). */
    oAuthEndpoint: string;
    /** OpenAPI base that mints the ec- key (/_keys/0). */
    openApiEndpoint: string;
    /** Flows API base for the post-mint propagation poll (/_api_/flows/0/profile). */
    apiUrl: string;
    region: string;
    project: string;
}

/**
 * Resolve the auth/login endpoints. Defaults target Eureka production; every value is overridable
 * via env so the same flow works against dev. `project` mirrors the web app's `flows_<env>`.
 */
export const resolveAuthEndpoints = (config: FlowApiConfig): AuthEndpoints => ({
    socialOAuthUrl: process.env.EUREKA_SOCIAL_OAUTH_URL || 'https://oauth2.eureka.codes',
    oAuthEndpoint: process.env.EUREKA_OAUTH_URL || 'https://api.eureka.codes/v1',
    openApiEndpoint: process.env.EUREKA_OPENAPI_URL || 'https://openapi.eureka.codes/v1',
    apiUrl: config.FLOW_API_URL,
    region: process.env.EUREKA_REGION || 'ap-northeast-2',
    project: process.env.EUREKA_PROJECT || `flows_${process.env.EUREKA_ENV || 'prod'}`,
});
