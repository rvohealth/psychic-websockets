import { DreamColumn, DreamSerializers } from '@rvoh/dream'
import ApplicationModel from './ApplicationModel.js'

export default class User extends ApplicationModel {
  public get table() {
    return 'users' as const
  }

  public get serializers(): DreamSerializers<User> {
    return {
      default: 'UserSerializer',
      summary: 'UserSummarySerializer',
    }
  }

  public id: DreamColumn<User, 'id'>
  public email: DreamColumn<User, 'email'>
  public createdAt: DreamColumn<User, 'createdAt'>
  public updatedAt: DreamColumn<User, 'updatedAt'>
}
