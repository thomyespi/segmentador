## ADDED Requirements

### Requirement: Creación de campaña por rubro y zona
El sistema SHALL permitir crear una campaña con un nombre y filtros de rubro y zona de selección múltiple, y SHALL mostrar en vivo la cantidad de destinatarios elegibles y la cantidad excluida por motivo (Enviar=NO, baja, plantilla ya recibida, plantilla no aprobada).

#### Scenario: Filtro multiselección
- **WHEN** el usuario elige los rubros "Construcción y materiales" e "Industria y maquinaria" y las zonas "Neuquén" y "Río Negro"
- **THEN** el sistema muestra cuántos contactos cumplen (rubro en la selección Y zona en la selección) y son elegibles
- **THEN** muestra el desglose de excluidos por motivo

#### Scenario: Sin filtro de zona
- **WHEN** el usuario elige un rubro y ninguna zona
- **THEN** el sistema considera todas las zonas para ese rubro

### Requirement: Vista previa del mensaje final
El sistema SHALL mostrar, para cada contacto de la campaña, la plantilla que le corresponde según su rubro y el texto final con `{{1}}` reemplazado por Variable 1 (nombre) y `{{2}}` por Variable 2 (empresa), incluyendo pie y botones.

#### Scenario: Vista previa de un contacto
- **WHEN** el usuario abre la vista previa de un contacto de rubro energía con nombre "Octavio" y empresa "369 Seguridad y Energía"
- **THEN** ve el cuerpo de gen12_energia con "Hola Octavio" y "para 369 Seguridad y Energía", el pie de baja y los botones "Me interesa" / "No, gracias"

### Requirement: Confirmación y encolado
El sistema SHALL encolar los envíos de una campaña solo cuando el usuario la confirma explícitamente, en una única operación atómica, congelando en ese momento la plantilla y las variables de cada destinatario.

#### Scenario: Confirmación de campaña
- **WHEN** el usuario confirma una campaña con 600 destinatarios elegibles
- **THEN** el sistema crea 600 envíos en estado "en cola" y la campaña pasa a estado "enviando"

#### Scenario: Cambio de datos después de confirmar
- **WHEN** después de confirmar se reimporta el Excel con otro nombre de contacto
- **THEN** los envíos ya encolados usan las variables congeladas al confirmar

### Requirement: Despacho en lotes con tope diario
El sistema SHALL despachar la cola en lotes mediante un job programado y SHALL respetar un tope diario configurable de destinatarios únicos en una ventana móvil de 24 horas (default 200), compartido entre todas las campañas y seguimientos. El sistema SHALL despachar solo dentro de la ventana horaria configurada.

#### Scenario: Tope diario alcanzado
- **WHEN** en las últimas 24 horas ya se enviaron mensajes a 200 destinatarios únicos y el tope es 200
- **THEN** el job no envía más mensajes y los pendientes siguen en cola hasta que se libere cupo

#### Scenario: Lote parcial por cupo
- **WHEN** quedan 30 lugares de cupo y el tamaño de lote es 50
- **THEN** el job envía como máximo 30 mensajes en esa corrida

#### Scenario: Cambio del tope
- **WHEN** el usuario cambia el tope diario a 250 en configuración
- **THEN** las siguientes corridas del job usan 250 como límite

### Requirement: Envío idempotente
El sistema SHALL garantizar que cada envío encolado se intente como máximo una vez por corrida y que dos corridas concurrentes nunca tomen el mismo envío. Un envío cuyo resultado sea incierto SHALL quedar marcado para revisión manual y SHALL NOT reintentarse automáticamente.

#### Scenario: Corridas superpuestas
- **WHEN** dos ejecuciones del job de despacho corren al mismo tiempo
- **THEN** cada envío en cola es tomado por una sola de ellas

#### Scenario: Corte a mitad de un envío
- **WHEN** un envío quedó tomado por más de 15 minutos sin resultado registrado
- **THEN** el sistema lo marca como "incierto", no lo reenvía y lo muestra en el panel para revisión

### Requirement: Sin repetir plantilla de campaña por número
El sistema SHALL NOT enviar nunca dos veces la misma plantilla de campaña al mismo número, incluyendo envíos de campañas distintas y envíos legacy importados.

#### Scenario: Contacto ya alcanzado por otra campaña
- **WHEN** se confirma una campaña que incluye un número que ya recibió gen12_construccion en una campaña anterior
- **THEN** el sistema no encola gen12_construccion para ese número y lo cuenta como excluido por "plantilla ya recibida"

### Requirement: Exclusión de bajas
El sistema SHALL excluir siempre a los contactos dados de baja, tanto al encolar como inmediatamente antes de cada envío, y SHALL cancelar los envíos en cola de un contacto que se da de baja.

#### Scenario: Baja entre el encolado y el envío
- **WHEN** un contacto con un envío en cola responde "BAJA" antes de que el job lo despache
- **THEN** el envío se cancela y no se manda

### Requirement: Pausa ante errores de cuenta o límite de Meta
El sistema SHALL pausar la campaña y mostrar un aviso visible en el panel con el código y el motivo cuando Meta responda HTTP 401 o 403, o los errores 131048, 131049, 131056 o 130429, o errores de plantilla pausada, deshabilitada o inexistente. Ante 401 o 403 el sistema SHALL además frenar todos los envíos hasta que un usuario lo reactive. Reanudar una campaña pausada SHALL requerir una acción manual.

#### Scenario: Error de límite de spam
- **WHEN** Meta responde el error 131048 al enviar un mensaje de la campaña
- **THEN** la campaña pasa a "pausada" con el código 131048 y su descripción
- **THEN** el mensaje vuelve a la cola sin contarse como fallido
- **THEN** el panel muestra un aviso con el motivo y el botón para reanudar

#### Scenario: Token inválido
- **WHEN** Meta responde HTTP 401
- **THEN** el sistema pausa la campaña, frena los envíos de todas las campañas y muestra el aviso en el panel

### Requirement: Reintentos de errores transitorios
El sistema SHALL reintentar los envíos que fallen por errores transitorios (errores 5xx, timeouts o errores genéricos temporales de Meta) con espera creciente y un máximo de 3 intentos, y SHALL marcar como fallido definitivo, con su código y detalle, cualquier otro error del destinatario.

#### Scenario: Error 500 de Meta
- **WHEN** un envío recibe HTTP 500
- **THEN** el sistema lo reprograma para un nuevo intento más tarde

#### Scenario: Agotó los intentos
- **WHEN** un envío falla por error transitorio por tercera vez
- **THEN** queda como fallido con el último código de error

#### Scenario: Número que no tiene WhatsApp
- **WHEN** Meta responde un error de destinatario no válido
- **THEN** el envío queda como fallido sin reintentos
