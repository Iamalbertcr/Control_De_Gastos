# Despliegue en Cloudflare Pages

La app ahora guarda la base de datos como un JSON compartido en Cloudflare KV
mediante la ruta `/api/data`.

## Configuracion necesaria

1. Despliegue el proyecto con Git integration o Wrangler. Cloudflare Pages
   Functions no funciona con Direct Upload desde el dashboard.
2. Cree un KV namespace en Cloudflare.
3. En el proyecto de Pages vaya a `Settings > Bindings > Add > KV namespace`.
4. Use uno de estos nombres de variable. La app acepta cualquiera de ellos:

```text
GASTOS_DB
KV
DB
CONTROL_GASTOS_DB
CONTROL_DE_GASTOS
GASTOS
```

   Si Cloudflare no le deja agregar `GASTOS_DB`, use `KV`.

5. Seleccione el KV namespace creado para Production y, si usa previews, tambien
   para Preview.
6. Haga redeploy del proyecto.

## Prueba rapida

Despues del redeploy, abra:

```text
https://TU-DOMINIO/api/data
```

Debe devolver un JSON con `usuarios`, `aportes` y `gastos`. Si devuelve un error
de binding KV, falta configurar el binding o falta redeploy.

## Desarrollo local

Para probar la Function localmente con Wrangler:

```powershell
npx wrangler pages dev . --kv=KV --compatibility-date=2026-05-14
```

Puede actualizar la fecha de compatibilidad cuando su version local de Wrangler
soporte una fecha mas nueva.

## Si el dashboard no deja agregar bindings

Use `wrangler.example.toml` como plantilla, cambie el `id` por el ID real del
KV namespace y renombre el archivo a `wrangler.toml`. Luego despliegue con:

```powershell
npx wrangler pages deploy .
```

En esta computadora Wrangler no esta autenticado. Para que Codex pueda hacer esa
configuracion remota por CLI, debe existir la variable `CLOUDFLARE_API_TOKEN` con
permisos para Pages y Workers KV.
