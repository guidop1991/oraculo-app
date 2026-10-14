# Supabase (para más adelante)

La app hoy funciona sin servidor: los datos de cada persona quedan en su celular y el administrador es local, con PIN. Esta carpeta es para cuando quieras guardar datos en la nube.

## Qué guarda `schema.sql`
- **profiles:** nombre, fecha de nacimiento, país y ciudad (lugar de residencia), con fecha de consentimiento.
- **feedback:** sugerencias y mensajes de las personas (hasta 1000 caracteres).
- Cada persona solo puede ver y borrar lo suyo. Las sugerencias solo las ves vos.

## Cuando quieras activarlo
1. Crear un proyecto gratis en supabase.com.
2. Authentication → Sign In / Providers → activar **Allow anonymous sign-ins**.
3. SQL Editor → pegar `schema.sql` → Run.
4. Pasarme la **Project URL** y la clave **anon public** (nunca la `service_role` ni tu contraseña). Yo conecto la app.

## Administrador con login (futuro)
Se agrega una tabla de administradores y un ingreso con email para vos solamente. Mientras tanto, los datos se ven desde el panel de Supabase (Table Editor), que usa tu cuenta de Supabase.

## Antes de publicar con datos reales
Aviso de privacidad, consentimiento y borrado de datos (Ley 25.326 de Protección de Datos Personales en Argentina). Conviene consultarlo con un profesional.
