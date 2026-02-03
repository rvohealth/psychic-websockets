import viteEnvValue from './viteEnvValue'

export default function baseWsUrl() {
  return `http://localhost:${viteEnvValue('VITE_WS_PORT') || viteEnvValue('VITE_PSYCHIC_ENV') === 'test' ? 8889 : 8888}`
}
