import { AppError, EventName } from '@punto-amigo/shared';
import { Usuario } from '../../domain/entities/Usuario';
import { Email } from '../../domain/value-objects/Email';
import { PlainPassword } from '../../domain/value-objects/PlainPassword';
import type {
  IClock,
  IEventPublisher,
  IPasswordHasher,
  IUsuarioRepository,
} from '../../domain/ports/out';

export interface RegisterUserInput {
  nombre: string;
  correo: string;
  contrasena: string;
  confirmacionContrasena: string;
  telefono?: string | undefined;
  correlationId: string;
}

export interface RegisterUserOutput {
  id: number;
  nombre: string;
  correo: string;
  roles: string[];
}

/**
 * Alta de una cuenta.
 *
 * SRS: RF1 a RF5, RF160 (toda cuenta nace como SOLICITANTE).
 */
export class RegisterUserUseCase {
  constructor(
    private readonly usuarios: IUsuarioRepository,
    private readonly hasher: IPasswordHasher,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock
  ) {}

  async execute(input: RegisterUserInput): Promise<RegisterUserOutput> {
    const email = Email.create(input.correo);
    const contrasena = PlainPassword.createWithConfirmation(
      input.contrasena,
      input.confirmacionContrasena
    );

    /**
     * Se comprueba antes por claridad del mensaje, pero la garantia real es la
     * restriccion UNIQUE de la base de datos: entre esta consulta y el INSERT
     * cabe otro registro con el mismo correo. El repositorio traduce ese choque
     * al mismo error, de modo que el resultado no depende de quien llegue antes.
     */
    if (await this.usuarios.existsByEmail(email)) {
      throw AppError.conflict('Ese correo ya esta registrado.');
    }

    const contrasenaHash = await this.hasher.hash(contrasena.reveal());

    const usuario = Usuario.register({
      nombre: input.nombre,
      email,
      contrasenaHash,
      telefono: input.telefono?.trim() ?? null,
    });

    const persistido = await this.usuarios.save(usuario);

    /**
     * El evento se encola en el outbox dentro de la misma transaccion que el
     * alta. notification-service lo consume para la bienvenida (RF89) y
     * admin-reporting para la auditoria (RF101).
     *
     * No lleva el hash ni el telefono: un evento circula por el broker y acaba
     * replicado en varios servicios, asi que solo debe llevar lo que sus
     * consumidores necesitan (SRS-MSG-06).
     */
    await this.eventos.enqueue(
      {
        eventName: EventName.UserRegistered,
        aggregateType: 'Usuario',
        aggregateId: persistido.id,
        payload: {
          userId: persistido.id,
          nombre: persistido.nombre,
          correo: persistido.email.value,
          roles: persistido.roles.toArray(),
          occurredAt: this.clock.now().toISOString(),
        },
      },
      input.correlationId
    );

    return {
      id: persistido.id,
      nombre: persistido.nombre,
      correo: persistido.email.value,
      roles: persistido.roles.toArray(),
    };
  }
}
