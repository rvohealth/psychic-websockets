import viteEnvValue from './viteEnvValue'

export default function baseWsUrl() {
  return `http://localhost:${viteEnvValue('VITE_PSYCHIC_ENV') === 'test' ? 7778 : 7777}`
}
