import { Env } from '@rvoh/dream'

const EnvInternal = new Env<{
  string: 'NODE_ENV' | 'PSYCHIC_CORE_DEVELOPMENT'
  // integer: 'PORT'
  boolean: 'DEBUG' | 'PSYCHIC_CORE_DEVELOPMENT' | 'PSYCHIC_DANGEROUSLY_PERMIT_WS_EXCEPTIONS'
}>()

export default EnvInternal
