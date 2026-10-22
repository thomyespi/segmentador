## ADDED Requirements

### Requirement: Reglas de seguimiento por campaña
El sistema SHALL permitir definir, por campaña, reglas de seguimiento ordenadas con un disparador ("leído y sin respuesta" o "entregado pero no leído"), una cantidad de días N y una plantilla de seguimiento. Una regla SHALL poder activarse y desactivarse sin borrarse.

#### Scenario: Regla de leído sin respuesta
- **WHEN** el usuario crea en una campaña la regla "leído y sin respuesta a los 3 días → gen12_seguimiento_1"
- **THEN** la regla queda activa y asociada a la campaña

#### Scenario: Advertencia en regla de no leídos
- **WHEN** el usuario crea una regla "entregado pero no leído"
- **THEN** el sistema le advierte que el estado leído depende de las confirmaciones de lectura del destinatario y que la regla puede alcanzar a quien sí leyó

### Requirement: Solo plantillas aprobadas
El sistema SHALL permitir asociar a una regla únicamente plantillas de seguimiento con estado aprobado, porque los seguimientos se envían fuera de la ventana de 24 h. El sistema SHALL NOT enviar texto libre como seguimiento y SHALL omitir los seguimientos de una regla cuya plantilla deje de estar aprobada.

#### Scenario: Plantilla pendiente de aprobación
- **WHEN** el usuario intenta asociar una plantilla en estado pendiente a una regla
- **THEN** el sistema no lo permite e indica que la plantilla debe estar aprobada en Meta

#### Scenario: Plantilla pausada después de crear la regla
- **WHEN** el job diario evalúa una regla cuya plantilla fue pausada por Meta
- **THEN** no encola seguimientos de esa regla y lo informa en el panel

### Requirement: Tope de seguimientos por contacto
El sistema SHALL limitar la cantidad de seguimientos por contacto y campaña a un máximo configurable por campaña, con valor por defecto 1.

#### Scenario: Tope alcanzado
- **WHEN** un contacto ya recibió 1 seguimiento de la campaña y el máximo es 1
- **THEN** el sistema no le encola más seguimientos aunque cumpla otra regla

### Requirement: Corte de la secuencia
El sistema SHALL cortar la secuencia de seguimientos de un contacto cuando haya respondido cualquier mensaje después del primer envío de la campaña, cuando se haya dado de baja o cuando el envío original haya fallado.

#### Scenario: Contacto que respondió
- **WHEN** un contacto respondió "Mandame info" y cumple los días de una regla
- **THEN** el sistema no le encola el seguimiento

#### Scenario: Contacto dado de baja
- **WHEN** un contacto tocó "No, gracias"
- **THEN** el sistema no le encola ningún seguimiento

#### Scenario: Envío original fallido
- **WHEN** el envío original de un contacto quedó como fallido
- **THEN** el sistema no le encola ningún seguimiento

### Requirement: Evaluación diaria programada
El sistema SHALL evaluar las reglas activas una vez por día mediante un job de `pg_cron` que, con `pg_net`, llame a una ruta del servidor protegida con `CRON_SECRET`, y SHALL encolar los seguimientos que correspondan. La evaluación SHALL ser idempotente: correrla dos veces el mismo día SHALL NOT duplicar seguimientos. Los seguimientos encolados SHALL despacharse con el mismo mecanismo y el mismo tope diario que las campañas.

#### Scenario: Seguimiento a los N días
- **WHEN** el job corre y un envío fue leído hace 3 días o más, sin respuesta, con una regla "leído y sin respuesta a los 3 días"
- **THEN** el sistema encola un seguimiento con la plantilla de la regla y las variables del contacto

#### Scenario: Doble ejecución
- **WHEN** el job se ejecuta dos veces el mismo día
- **THEN** cada seguimiento se encola una sola vez

#### Scenario: Llamada sin secreto
- **WHEN** alguien llama a la ruta de seguimientos sin el `CRON_SECRET` correcto
- **THEN** la ruta responde 401 y no evalúa reglas

#### Scenario: Todavía no pasaron los días
- **WHEN** un envío fue entregado hace 2 días, no fue leído y la regla es "entregado pero no leído a los 4 días"
- **THEN** el sistema no encola el seguimiento
