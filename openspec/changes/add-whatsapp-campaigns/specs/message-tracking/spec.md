## ADDED Requirements

### Requirement: Verificación del webhook
El sistema SHALL exponer un endpoint de webhook que, ante un GET con `hub.mode=subscribe` y `hub.verify_token` igual a `WA_VERIFY_TOKEN`, responda 200 con el valor de `hub.challenge` en texto plano, y SHALL responder 403 en cualquier otro caso.

#### Scenario: Verificación correcta
- **WHEN** Meta hace GET con `hub.mode=subscribe`, el verify token correcto y `hub.challenge=12345`
- **THEN** el endpoint responde 200 con el cuerpo "12345"

#### Scenario: Verify token incorrecto
- **WHEN** llega un GET con un `hub.verify_token` distinto
- **THEN** el endpoint responde 403

### Requirement: Validación de firma
El sistema SHALL validar en cada POST al webhook el encabezado `X-Hub-Signature-256` calculando HMAC-SHA256 del cuerpo crudo con `WA_APP_SECRET` y comparando en tiempo constante. Si la firma falta o no coincide, el sistema SHALL responder 401 y SHALL NOT guardar ni procesar el contenido.

#### Scenario: Firma inválida
- **WHEN** llega un POST con un `X-Hub-Signature-256` que no corresponde al cuerpo
- **THEN** el endpoint responde 401 y no se registra ningún evento

#### Scenario: Firma ausente
- **WHEN** llega un POST sin el encabezado `X-Hub-Signature-256`
- **THEN** el endpoint responde 401 y no se registra ningún evento

#### Scenario: Firma válida
- **WHEN** llega un POST con firma correcta
- **THEN** el sistema guarda el evento crudo, lo procesa y responde 200

### Requirement: Registro crudo e idempotente de eventos
El sistema SHALL guardar cada evento recibido con firma válida en un log crudo con su payload completo y SHALL ignorar los eventos de estado duplicados (mismo wamid, estado y timestamp). El endpoint SHALL responder 200 aunque falle el procesamiento de un evento, dejando registrado el error para reprocesarlo.

#### Scenario: Evento repetido
- **WHEN** Meta reenvía el mismo status "delivered" del mismo wamid con el mismo timestamp
- **THEN** el sistema no lo procesa de nuevo y responde 200

#### Scenario: Estado de un wamid todavía no registrado
- **WHEN** llega un status de un wamid que aún no está asociado a ningún envío
- **THEN** el evento queda pendiente y se reprocesa en una corrida posterior

### Requirement: Estados de entrega monotónicos
El sistema SHALL registrar los estados sent, delivered, read y failed de cada envío con su fecha y hora, y para failed el código, título y detalle del error. El estado actual SHALL avanzar solo en el orden sent < delivered < read y SHALL NOT retroceder aunque los eventos lleguen desordenados. Un read SHALL implicar entregado. El estado failed SHALL registrarse aparte, sin borrar fechas previas.

#### Scenario: Eventos desordenados
- **WHEN** para un mismo wamid llega primero "read" y después "delivered"
- **THEN** el estado actual queda en "read"
- **THEN** quedan guardadas la fecha de lectura y la fecha de entrega

#### Scenario: Read sin delivered
- **WHEN** llega "read" de un wamid que nunca recibió "delivered"
- **THEN** el estado queda en "read" y la fecha de entrega se completa con la de lectura

#### Scenario: Mensaje fallido
- **WHEN** llega un status "failed" con el error 131026
- **THEN** el envío queda como fallido con fecha, código 131026 y su detalle

### Requirement: Alcance del estado "read"
El sistema SHALL tratar el estado "read" como informativo y no garantizado: Meta solo lo informa si el destinatario tiene activadas las confirmaciones de lectura. La interfaz SHALL indicarlo junto a toda métrica o regla basada en lecturas.

#### Scenario: Destinatario con confirmaciones de lectura desactivadas
- **WHEN** un destinatario con confirmaciones de lectura desactivadas abre el mensaje
- **THEN** el envío permanece en "delivered" y el panel aclara que los leídos son un mínimo

### Requirement: Registro de pricing y costo estimado
El sistema SHALL guardar el objeto `pricing` de cada status recibido (billable, modelo, categoría y tipo) y SHALL calcular un costo estimado por envío a partir de una tarifa configurable cuando el envío sea facturable.

#### Scenario: Status con pricing facturable
- **WHEN** llega un status con `pricing.billable=true` y categoría "marketing"
- **THEN** el envío guarda el pricing y un costo estimado igual a la tarifa de marketing configurada

#### Scenario: Status no facturable
- **WHEN** llega un status con `pricing.billable=false`
- **THEN** el costo estimado del envío es 0

### Requirement: Registro de respuestas entrantes
El sistema SHALL registrar cada mensaje entrante con su número, fecha, tipo, texto y, si es respuesta a un botón, el texto y payload del botón. El sistema SHALL asociarlo al envío al que responde usando el contexto del mensaje y, si no viene, al último envío a ese número.

#### Scenario: Respuesta con botón "Me interesa"
- **WHEN** un contacto toca el botón "Me interesa" de la plantilla
- **THEN** el sistema guarda la respuesta asociada a ese envío y la marca como interesado

#### Scenario: Respuesta de texto libre
- **WHEN** un contacto responde "¿Cuánto sale una web?"
- **THEN** el sistema guarda el texto asociado al envío y al contacto

### Requirement: Baja por respuesta
El sistema SHALL dar de baja (opt-out) al contacto cuando toque el botón "No, gracias" o envíe un texto que contenga la palabra BAJA, sin distinguir mayúsculas, minúsculas ni acentos. La baja SHALL cancelar sus envíos en cola y excluirlo de todas las campañas y seguimientos futuros.

#### Scenario: Baja por botón
- **WHEN** un contacto toca el botón "No, gracias"
- **THEN** el sistema registra la baja con origen "button"
- **THEN** cancela los envíos en cola de ese contacto

#### Scenario: Baja por texto
- **WHEN** un contacto responde "baja por favor"
- **THEN** el sistema registra la baja con origen "keyword"

#### Scenario: Texto que no es baja
- **WHEN** un contacto responde "Trabajamos en Bahía Blanca"
- **THEN** el sistema no registra la baja, porque BAJA no aparece como palabra completa

### Requirement: Estado de plantillas informado por Meta
El sistema SHALL actualizar el estado de una plantilla cuando reciba un evento de cambio de estado o calidad de plantilla y, si la plantilla queda pausada o deshabilitada, SHALL pausar las campañas que la usan.

#### Scenario: Plantilla pausada por Meta
- **WHEN** llega un evento indicando que gen12_salud pasó a "PAUSED"
- **THEN** la plantilla queda en estado pausada y las campañas en curso que la usan pasan a "pausada" con ese motivo
