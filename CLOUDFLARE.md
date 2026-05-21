# Despliegue en Cloudflare Pages

La app ahora guarda la base de datos como un JSON compartido en Cloudflare KV
mediante la ruta `/api/data`.

## Configuracion necesaria

1. Despliegue el proyecto con Git integration o Wrangler. Cloudflare Pages
   Functions no funciona con Direct Upload desde el dashboard.
2. Cree un KV namespace en Cloudflare.
3. En el proyecto de Pages vaya a `Settings > Bindings > Add > KV namespace`.
4. Use exactamente este nombre de variable:

```text
GASTOS_DB
```

5. Seleccione el KV namespace creado para Production y, si usa previews, tambien
   para Preview.
6. Haga redeploy del proyecto.

## Prueba rapida

Despues del redeploy, abra:

```text
https://TU-DOMINIO/api/data
```

Debe devolver un JSON con `usuarios`, `aportes` y `gastos`. Si devuelve un error
de `GASTOS_DB`, falta configurar el binding KV o falta redeploy.

## Desarrollo local

Para probar la Function localmente con Wrangler:

```powershell
npx wrangler pages dev . --kv=GASTOS_DB --compatibility-date=2026-05-14
```

Puede actualizar la fecha de compatibilidad cuando su version local de Wrangler
soporte una fecha mas nueva.
