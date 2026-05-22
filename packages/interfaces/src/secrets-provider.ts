/**
 * SecretsProvider — interface for retrieving secrets at runtime (DEPLOY-002).
 *
 * Production implementation calls AWS Secrets Manager GetSecretValue.
 * Local stub returns values from environment variables directly.
 *
 * The interface is narrow by design: only getSecret is needed because
 * the composition root fetches secrets once at startup. Rotation handling
 * is a separate concern (RDS credentials rotation uses the ARN pattern
 * where the ARN is stable and the value is fetched at connection pool refresh).
 */

export interface SecretsProvider {
  /**
   * Retrieve a secret value by its identifier (ARN for AWS, key name for local).
   * Returns the secret string value.
   * Throws if the secret cannot be retrieved.
   */
  getSecret(secretId: string): Promise<string>;
}
