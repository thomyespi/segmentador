## ADDED Requirements

### Requirement: Importación del Excel segmentado
El sistema SHALL permitir a un usuario autenticado subir "Base segmentada Gen12.xlsx" y SHALL importar las filas de la hoja "Contactos", guardando por contacto: ID, Contacto, Empresa, Rubro Gen12, Origen del rubro, Zona, Origen de la zona, WhatsApp, Plantilla, Variable 1 (nombre), Variable 2 (empresa) y las columnas originales (Nombre original, Localidad original, Rubro original, Segmento original, CUIT/DNI, Tiene página?, Asesor).

#### Scenario: Importación inicial exitosa
- **WHEN** el usuario sube el Excel con la hoja "Contactos" y todas las columnas requeridas
- **THEN** el sistema crea un contacto por número válido con todos los campos y los datos originales
- **THEN** muestra un resumen con filas leídas, contactos creados, actualizados, duplicados e inválidos

#### Scenario: Falta la hoja o una columna requerida
- **WHEN** el archivo no tiene la hoja "Contactos" o le falta una columna requerida (por ejemplo "WhatsApp")
- **THEN** el sistema rechaza la importación sin escribir ningún dato e indica qué falta

### Requirement: Upsert por número de WhatsApp
El sistema SHALL identificar a cada contacto por su número de WhatsApp normalizado (solo dígitos, formato 549 seguido de 10 dígitos) y SHALL hacer upsert: crear el contacto si el número no existe o actualizar sus datos descriptivos si ya existe.

#### Scenario: Contacto existente con datos nuevos
- **WHEN** se importa una fila cuyo WhatsApp ya existe en la base con otra Empresa o Zona
- **THEN** el sistema actualiza Empresa y Zona del contacto existente sin crear uno nuevo

#### Scenario: Número con formato inválido
- **WHEN** una fila tiene un WhatsApp que, tras quitar caracteres no numéricos, no cumple el formato 549XXXXXXXXXX
- **THEN** el sistema no importa esa fila y la lista en el reporte como inválida con su ID

### Requirement: Deduplicación de teléfonos
El sistema SHALL deduplicar los números repetidos dentro de un mismo archivo, conservando la primera fila por ID, y SHALL marcar el contacto como no enviable si cualquiera de las filas duplicadas tiene Enviar=NO, salvo que el Motivo exclusión de esa fila sea "Teléfono repetido" (la propia segmentación marca así las copias).

#### Scenario: Mismo número en dos filas
- **WHEN** el archivo trae dos filas con el mismo WhatsApp y ambas con Enviar=SI
- **THEN** el sistema crea un único contacto con los datos de la fila de menor ID y reporta la otra como duplicada

#### Scenario: Duplicado con exclusión
- **WHEN** el archivo trae dos filas con el mismo WhatsApp, una con Enviar=SI y otra con Enviar=NO
- **THEN** el contacto queda como no enviable con el Motivo exclusión de la fila con Enviar=NO

#### Scenario: Copia marcada como teléfono repetido
- **WHEN** el archivo trae una fila con Enviar=SI y otra con el mismo WhatsApp, Enviar=NO y Motivo exclusión "Teléfono repetido"
- **THEN** el contacto queda enviable con los datos de la fila con Enviar=SI

### Requirement: Respeto de Enviar=NO
El sistema SHALL guardar la columna Enviar y el Motivo exclusión, y SHALL impedir que un contacto con Enviar=NO sea incluido en cualquier campaña o seguimiento.

#### Scenario: Contacto excluido en el Excel
- **WHEN** se importa una fila con Enviar=NO y Motivo exclusión "Competencia"
- **THEN** el contacto queda guardado como no enviable con ese motivo
- **THEN** no aparece en el conteo ni en la vista previa de ninguna campaña

### Requirement: Reimportación sin pisar el historial
El sistema SHALL permitir reimportar el Excel tantas veces como se quiera y SHALL conservar intactos los envíos, estados, respuestas y bajas ya registrados. Una reimportación con Enviar=SI SHALL NOT revertir una baja.

#### Scenario: Reimportación de un contacto con envíos
- **WHEN** se reimporta el Excel y un contacto ya tiene mensajes enviados y leídos
- **THEN** el sistema actualiza sus datos descriptivos y deja sin cambios sus mensajes, estados y respuestas

#### Scenario: Reimportación de un contacto dado de baja
- **WHEN** se reimporta una fila con Enviar=SI de un número que pidió la baja por WhatsApp
- **THEN** el contacto sigue dado de baja y excluido de los envíos

### Requirement: Importación del historial previo
El sistema SHALL registrar como envío previo de tipo legacy cada fila cuya columna "Estado envío" indique "enviado", con la plantilla de la columna Plantilla, y SHALL permitir importar las bajas de `bajas.txt` (un número por línea) y, opcionalmente, `envios_log.csv`, para no repetir envíos hechos con el script anterior ni contactar bajas previas.

#### Scenario: Fila ya enviada por el script anterior
- **WHEN** se importa una fila con Estado envío "enviado 15/10" y Plantilla "gen12_energia"
- **THEN** el sistema registra un envío legacy de gen12_energia para ese número
- **THEN** ese número queda excluido de cualquier campaña que use gen12_energia

#### Scenario: Archivo de bajas
- **WHEN** el usuario sube `bajas.txt` con números en formato 549...
- **THEN** el sistema registra una baja con origen "legacy_file" por cada número válido, ignorando líneas de comentario y vacías

### Requirement: Registro de cada importación
El sistema SHALL guardar una bitácora de cada importación con nombre de archivo, usuario, fecha y totales de filas leídas, creadas, actualizadas, duplicadas e inválidas.

#### Scenario: Consulta de importaciones
- **WHEN** el usuario abre la sección de importaciones
- **THEN** ve la lista de importaciones con sus totales y puede descargar el detalle de filas inválidas y duplicadas
