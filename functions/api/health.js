const KV_BINDING_NAMES = [
    'GASTOS_DB',
    'CONTROL_GASTOS_DB',
    'CONTROL_DE_GASTOS',
    'GASTOS',
    'KV',
    'DB',
    'DATA'
];

function isKVNamespace(value) {
    return value && typeof value.get === 'function' && typeof value.put === 'function';
}

function findKVBinding(env = {}) {
    for (const bindingName of KV_BINDING_NAMES) {
        if (isKVNamespace(env[bindingName])) {
            return bindingName;
        }
    }

    const detectedName = Object.keys(env).find(key => isKVNamespace(env[key]));
    return detectedName || null;
}

export function onRequestGet(context) {
    const binding = findKVBinding(context.env);

    return Response.json({
        ok: Boolean(binding),
        binding,
        acceptedBindings: KV_BINDING_NAMES,
        message: binding
            ? `KV conectado con el binding ${binding}.`
            : 'No se detecto ningun binding KV en esta Pages Function.'
    }, {
        headers: {
            'Cache-Control': 'no-store'
        }
    });
}
