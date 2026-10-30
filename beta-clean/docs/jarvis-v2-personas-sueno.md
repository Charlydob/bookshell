# Personas y sueño: modelos verificables, aún no publicados

## Personas: reutilización real encontrada

La revisión adicional encontró más que notas libres: runtime Notas implementa noteKind=persona; person.firstName, lastName, nationality, phone, birthday, address, socials y notesEntries. Mantiene ubicación, etiquetas y carpetas, reconoce duplicados por título/teléfono y calcula linkedPeople y mentioningNotes mediante enlaces wiki. syncPersonBirthdayReminder ya crea/actualiza un recordatorio anual vinculado a noteId, o lo cancela si se quita el cumpleaños.

Los enlaces wiki y coincidencias de etiquetas no demuestran amistad, parentesco ni quién presentó a quién. No hay evidencia de una entidad tipada de relación social con estado confirmado/hipótesis. La auditoría inicial debe ampliarse con este hallazgo; no se necesita crear otra tabla de personas ignorando las fichas existentes.

Se propone conservar el identificador de nota como identidad de persona y añadir una extensión tipada con aliases, firstMet (fecha/lugar/contextNoteId) y relationships (targetNoteId, etiqueta aportada, estado confirmed/hypothesis y fuente user). jarvis/future-models.js incluye un contrato estricto probado; no lo guarda ni lo expone a ChatGPT todavía.

El servicio futuro deberá resolver ambas notas por propietario y verificar noteKind=persona, rechazar autobucles y referencias inexistentes, registrar procedencia y conservar campos privados. Las fusiones tendrán vista previa, confirmación humana y remapeo transaccional de enlaces y recordatorios. No se inferirá cumpleaños ni se generará un año ficticio si solo se conoce día/mes; se ampliará el contrato antes de guardar una fecha incompleta.

Hay que adaptar las dos rutas de edición web de person: reconstruyen el objeto y podrían perder campos nuevos. La protección visual de una carpeta no sustituye permisos de backend. Estos cambios y la frontera privada del acceso web son requisitos previos a publicar tools de personas. No se han guardado las personas de los ejemplos.

## Sueño y descanso

No se encontró un modelo específico de sueño en el módulo Hábitos. Un hábito de tiempo permite registrar duración declarada, pero no distingue por sí solo tiempo en cama, sueño observado, pausas o fuente. Tampoco hay una conexión autorizada de salud o tiempo de pantalla disponible en esta entrega.

Contrato propuesto y probado: observación in_bed o asleep; inicio/fin con zona; fuente user_declared o authorized_provider; identificador externo opcional. Duraciones ausentes permanecen desconocidas. summarizeRest devuelve null para sueño si solo se declaró tiempo en cama, une intervalos duplicados y rechaza mensajes como fuente. No se publica una herramienta ni se conecta un proveedor mediante ese contrato.

Primera integración futura verificable: registro manual explícito, consulta de duración declarada, regularidad de hora declarada y preferencia de acostarse con aviso opcional en el mismo scheduler. La regularidad se calculará sobre observaciones existentes, tratando correctamente medianoche y zona. Registrar acostarse/despertarse no se presentará automáticamente como medición clínica de sueño.

Fuentes futuras, sujetas a disponibilidad y consentimiento: importación del proveedor de salud mediante API/exportación legítima y lectura de estadísticas de dispositivo si el sistema ofrece acceso autorizado. No hay reconocimiento de uso del móvil desde ChatGPT, y la ausencia de mensajes nunca constituye prueba de sueño.

Estos son contratos y propuestas contrastables. No se han instalado tools sleep/persons ni generado observaciones personales; deben permanecer fuera del inventario de capacidades disponibles hasta superar permisos, persistencia, interfaz y pruebas de integración.
