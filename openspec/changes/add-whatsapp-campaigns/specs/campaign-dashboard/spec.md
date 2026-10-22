## ADDED Requirements

### Requirement: Métricas por campaña
El sistema SHALL mostrar por campaña: en cola, enviados, entregados, leídos, fallidos, inciertos, contactos que respondieron, "Me interesa", bajas y costo estimado. Entregados SHALL incluir a los leídos. Los leídos SHALL mostrarse con la aclaración de que dependen de las confirmaciones de lectura. El costo SHALL rotularse como estimado.

#### Scenario: Campaña en curso
- **WHEN** el usuario abre una campaña con 200 enviados, 180 entregados (60 de ellos leídos), 5 fallidos, 12 respuestas, 4 "Me interesa" y 3 bajas
- **THEN** el panel muestra esos valores y el costo estimado según los envíos facturables

#### Scenario: Seguimientos dentro de la campaña
- **WHEN** la campaña tiene seguimientos enviados
- **THEN** el panel muestra las métricas de envíos originales y de seguimientos por separado y en total

### Requirement: Estado de la campaña y avisos
El sistema SHALL mostrar el estado de cada campaña (borrador, enviando, pausada, completada, cancelada), el avance de la cola, el cupo diario disponible y, si está pausada, un aviso destacado con el código y motivo del error y la acción para reanudar.

#### Scenario: Campaña pausada
- **WHEN** una campaña fue pausada por el error 130429
- **THEN** el listado y el detalle muestran el aviso con el código 130429, su descripción y la fecha de pausa

### Requirement: Tabla por contacto
El sistema SHALL mostrar en cada campaña una tabla con una fila por contacto: nombre, empresa, rubro, zona, WhatsApp, plantilla, estado actual, fechas de envío, entrega y lectura, error si lo hubo, cantidad de seguimientos, última respuesta con su fecha e indicador de baja.

#### Scenario: Contacto que respondió
- **WHEN** un contacto respondió "Me interesa"
- **THEN** su fila muestra "Me interesa" como última respuesta con la fecha

### Requirement: Filtros de la tabla
El sistema SHALL permitir filtrar la tabla por estado, rubro, zona, si respondió, si marcó "Me interesa", si se dio de baja, y buscar por nombre, empresa o número.

#### Scenario: Filtrar interesados
- **WHEN** el usuario filtra por "Me interesa"
- **THEN** la tabla muestra solo los contactos cuya respuesta fue "Me interesa"

### Requirement: Exportación a CSV
El sistema SHALL exportar a CSV las filas de la tabla con los filtros aplicados, en UTF-8 con BOM para que Excel muestre bien los acentos.

#### Scenario: Exportar con filtros
- **WHEN** el usuario filtra por zona "Neuquén" y estado "leído" y pide exportar
- **THEN** descarga un CSV con solo esas filas y todas las columnas de la tabla

### Requirement: Acceso restringido
El sistema SHALL exigir sesión de Supabase Auth para ver cualquier pantalla o dato, y en v1 todo usuario autenticado SHALL tener acceso total. Las tablas SHALL tener RLS habilitado de modo que un cliente sin sesión no pueda leer ni escribir datos.

#### Scenario: Usuario sin sesión
- **WHEN** alguien sin sesión abre el panel
- **THEN** es redirigido a la pantalla de login

#### Scenario: Acceso directo con la clave anónima
- **WHEN** un cliente consulta la tabla de contactos con la clave anónima y sin sesión
- **THEN** no obtiene ninguna fila
