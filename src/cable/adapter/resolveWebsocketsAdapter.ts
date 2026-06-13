import EnvInternal from '../../helpers/EnvInternal.js'
import InProcessWebsocketsAdapter from './InProcessWebsocketsAdapter.js'
import { PsychicWebsocketsAdapter } from './PsychicWebsocketsAdapter.js'
import RedisWebsocketsAdapter from './RedisWebsocketsAdapter.js'

/**
 * What an app may pass to `wsApp.set('adapter', ...)`: one of the two built-in
 * adapter names, or a custom adapter instance.
 */
export type WebsocketsAdapterSelector = 'redis' | 'in_process' | PsychicWebsocketsAdapter

/**
 * Resolves the configured adapter selector to a concrete adapter instance,
 * cable.yml-style. When nothing is configured, the default is environment-based:
 *
 *   - `test`        → in-process (hermetic specs, no redis)
 *   - `development` → redis (kept faithful to production)
 *   - `production`  → redis
 *
 * Override per environment with `wsApp.set('adapter', 'redis' | 'in_process')` or by
 * passing a custom {@link PsychicWebsocketsAdapter} instance.
 */
export default function resolveWebsocketsAdapter(
  selector: WebsocketsAdapterSelector | undefined,
): PsychicWebsocketsAdapter {
  if (selector === undefined) {
    return EnvInternal.isTest ? new InProcessWebsocketsAdapter() : new RedisWebsocketsAdapter()
  }

  if (selector === 'redis') return new RedisWebsocketsAdapter()
  if (selector === 'in_process') return new InProcessWebsocketsAdapter()

  return selector
}
