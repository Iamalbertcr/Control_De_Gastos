const DATA_KEY = 'control-gastos-db';
const COLLECTIONS = ['usuarios', 'aportes', 'gastos'];

function jsonResponse(body, status = 200) {
    return Response.json(body, {
        status,
        headers: {
            'Cache-Control': 'no-store'
        }
    });
}

function getKV(context) {
    return context.env.GASTOS_DB;
}

function normalizeData(data = {}) {
    return {
        usuarios: Array.isArray(data.usuarios) ? data.usuarios : [],
        aportes: Array.isArray(data.aportes) ? data.aportes : [],
        gastos: Array.isArray(data.gastos) ? data.gastos : [],
        updatedAt: data.updatedAt || null
    };
}

async function readData(kv) {
    const storedValue = await kv.get(DATA_KEY);
    if (!storedValue) {
        return normalizeData();
    }

    try {
        return normalizeData(JSON.parse(storedValue));
    } catch (error) {
        return normalizeData();
    }
}

async function writeData(kv, data) {
    const nextData = normalizeData({
        ...data,
        updatedAt: new Date().toISOString()
    });

    await kv.put(DATA_KEY, JSON.stringify(nextData));
    return nextData;
}

function validateCollection(collection) {
    return COLLECTIONS.includes(collection);
}

function upsertById(items, nextItems) {
    const itemMap = new Map(items.filter(item => item && item.id).map(item => [item.id, item]));

    nextItems.forEach(item => {
        if (item && item.id) {
            itemMap.set(item.id, item);
        }
    });

    return Array.from(itemMap.values());
}

function requireKV(context) {
    const kv = getKV(context);
    if (!kv) {
        return {
            error: jsonResponse({
                error: 'Falta configurar el binding KV GASTOS_DB en Cloudflare Pages.'
            }, 500)
        };
    }

    return { kv };
}

export async function onRequestGet(context) {
    const { kv, error } = requireKV(context);
    if (error) return error;

    const data = await readData(kv);
    return jsonResponse(data);
}

export async function onRequestPut(context) {
    const { kv, error } = requireKV(context);
    if (error) return error;

    const body = await context.request.json().catch(() => null);
    if (!body) {
        return jsonResponse({ error: 'JSON invalido.' }, 400);
    }

    const data = await writeData(kv, body);
    return jsonResponse(data);
}

export async function onRequestPatch(context) {
    const { kv, error } = requireKV(context);
    if (error) return error;

    const patch = await context.request.json().catch(() => null);
    if (!patch || !validateCollection(patch.collection)) {
        return jsonResponse({ error: 'Coleccion invalida.' }, 400);
    }

    const data = await readData(kv);
    const currentItems = data[patch.collection];

    if (patch.clear) {
        data[patch.collection] = [];
    } else {
        const deletedIds = new Set(Array.isArray(patch.deletedIds) ? patch.deletedIds : []);
        const keptItems = currentItems.filter(item => item && !deletedIds.has(item.id));
        const upserted = Array.isArray(patch.upserted) ? patch.upserted : [];
        data[patch.collection] = upsertById(keptItems, upserted);
    }

    const nextData = await writeData(kv, data);
    return jsonResponse(nextData);
}
