const LEGACY_DATA_KEY = 'control-gastos-db';
const UPDATED_AT_KEY = 'meta/updatedAt';
const COLLECTIONS = ['usuarios', 'aportes', 'gastos'];
const KV_BINDING_NAMES = [
    'GASTOS_DB',
    'CONTROL_GASTOS_DB',
    'CONTROL_DE_GASTOS',
    'GASTOS',
    'KV',
    'DB',
    'DATA'
];

function jsonResponse(body, status = 200) {
    return Response.json(body, {
        status,
        headers: {
            'Cache-Control': 'no-store'
        }
    });
}

function isKVNamespace(value) {
    return value && typeof value.get === 'function' && typeof value.put === 'function';
}

function getKV(context) {
    const env = context.env || {};

    for (const bindingName of KV_BINDING_NAMES) {
        if (isKVNamespace(env[bindingName])) {
            return env[bindingName];
        }
    }

    return Object.values(env).find(isKVNamespace) || null;
}

function normalizeData(data = {}) {
    return {
        usuarios: Array.isArray(data.usuarios) ? data.usuarios : [],
        aportes: Array.isArray(data.aportes) ? data.aportes : [],
        gastos: Array.isArray(data.gastos) ? data.gastos : [],
        updatedAt: data.updatedAt || null
    };
}

function validateCollection(collection) {
    return COLLECTIONS.includes(collection);
}

function itemKey(collection, id) {
    return `${collection}/${id}`;
}

function safeJsonParse(value, fallback = null) {
    try {
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        return fallback;
    }
}

async function listKeys(kv, prefix) {
    const names = [];
    let cursor;

    do {
        const result = await kv.list({ prefix, cursor });
        names.push(...result.keys.map(key => key.name));
        cursor = result.list_complete ? null : result.cursor;
    } while (cursor);

    return names;
}

async function readCollection(kv, collection) {
    const keys = await listKeys(kv, `${collection}/`);
    const values = await Promise.all(keys.map(key => kv.get(key)));

    return values
        .map(value => safeJsonParse(value))
        .filter(item => item && item.id);
}

async function readLegacyData(kv) {
    const storedValue = await kv.get(LEGACY_DATA_KEY);
    return normalizeData(safeJsonParse(storedValue, {}));
}

function hasRecords(data) {
    return COLLECTIONS.some(collection => data[collection].length > 0);
}

async function readData(kv) {
    const [usuarios, aportes, gastos, updatedAt] = await Promise.all([
        readCollection(kv, 'usuarios'),
        readCollection(kv, 'aportes'),
        readCollection(kv, 'gastos'),
        kv.get(UPDATED_AT_KEY)
    ]);

    const data = normalizeData({ usuarios, aportes, gastos, updatedAt });
    if (hasRecords(data)) {
        return data;
    }

    if (updatedAt) {
        return data;
    }

    const legacyData = await readLegacyData(kv);
    if (hasRecords(legacyData)) {
        await writeData(kv, legacyData);
        return legacyData;
    }

    return data;
}

async function clearCollection(kv, collection) {
    const keys = await listKeys(kv, `${collection}/`);
    await Promise.all(keys.map(key => kv.delete(key)));
}

async function putItems(kv, collection, items) {
    await Promise.all(
        items
            .filter(item => item && item.id)
            .map(item => kv.put(itemKey(collection, item.id), JSON.stringify(item)))
    );
}

async function writeUpdatedAt(kv) {
    const updatedAt = new Date().toISOString();
    await kv.put(UPDATED_AT_KEY, updatedAt);
    return updatedAt;
}

async function writeData(kv, data) {
    const nextData = normalizeData(data);

    await Promise.all(COLLECTIONS.map(collection => clearCollection(kv, collection)));
    await Promise.all(COLLECTIONS.map(collection => putItems(kv, collection, nextData[collection])));
    await kv.delete(LEGACY_DATA_KEY);
    nextData.updatedAt = await writeUpdatedAt(kv);

    return nextData;
}

function requireKV(context) {
    const kv = getKV(context);
    if (!kv) {
        return {
            error: jsonResponse({
                error: 'Falta configurar un binding KV. Use GASTOS_DB, KV, DB o CONTROL_GASTOS_DB en Cloudflare Pages.'
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

    if (patch.clear) {
        await clearCollection(kv, patch.collection);
    } else {
        const deletedIds = Array.isArray(patch.deletedIds) ? patch.deletedIds : [];
        const upserted = Array.isArray(patch.upserted) ? patch.upserted : [];

        await Promise.all([
            ...deletedIds.map(id => kv.delete(itemKey(patch.collection, id))),
            ...upserted
                .filter(item => item && item.id)
                .map(item => kv.put(itemKey(patch.collection, item.id), JSON.stringify(item)))
        ]);
    }

    await writeUpdatedAt(kv);
    const nextData = await readData(kv);
    return jsonResponse(nextData);
}
