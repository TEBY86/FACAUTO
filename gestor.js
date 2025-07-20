// ✅ ahora si
// — versión funcional con GPT y validación JSON

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const { OpenAI } = require('openai');
const { bot2 } = require('./bots/bot2');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const bot = new Telegraf( process.env.BOT_TOKEN );
// 🔵 INICIO CAMBIO
bot.command('admin', async (ctx) => {
  await ctx.reply(`✏️ Instrucciones:

1️⃣ Escribe primero el comando:
- /factibilidad → Verifica en base local si la dirección existe (más seguro).
- /forzar → Envía la dirección directo al sistema WOM, sin validación previa.

2️⃣ Luego ingresa la dirección en este formato:

🌎 Región, 🏙️ Comuna, 🛣️ Calle XXX, 🔢 Número XXX [, 🏢 Torre/Piso XXX] [, 📦 Depto XXX]

✅ Ejemplos:
- /factibilidad Libertador Bernardo O'Higgins, Rancagua, Calle XXX, Número XXX
- /forzar Metropolitana, Santiago, Calle XXX, Número XXX, Torre XXX, Depto XXX

📌 Separa cada dato con comas ( , ).`);
});
// 🔵 FIN CAMBIO



function normalizarTexto(texto) {
  return texto.toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

function generarVariaciones(direccion) {
  const variantes = new Set();
  const base = normalizarTexto(direccion);
  variantes.add(base);

  const prefijos = [
    ['avenida', 'av'], ['av', 'avenida'],
    ['pasaje', 'psje'], ['psje', 'pasaje'],
    ['calle', ''], ['', 'calle']
  ];

  const partes = base.split(' ');
  const ultimaParte = partes[partes.length - 1];
  if (!isNaN(ultimaParte)) {
    const num = parseInt(ultimaParte);
    variantes.add(partes.slice(0, -1).join(' ') + ' ' + num);
    variantes.add(partes.slice(0, -1).join(' ') + ' ' + num.toString().padStart(4, '0'));
  }

  for (const [a, b] of prefijos) {
    if (base.startsWith(a + ' ')) variantes.add(base.replace(a, b));
    if (base.startsWith(b + ' ')) variantes.add(base.replace(b, a));
  }

  return [...variantes];
}

function calcularDistanciaLevenshtein(a, b) {
  const matriz = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) matriz[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      matriz[i][j] = Math.min(
        matriz[i - 1][j] + 1,
        matriz[i][j - 1] + 1,
        matriz[i - 1][j - 1] + costo
      );
    }
  }
  return matriz[a.length][b.length];
}

function obtenerSugerencias(direccionBuscada, listaDirecciones, limite = 3) {
  const similitudes = listaDirecciones.map(dir => {
    const dirNormal = normalizarTexto(dir);
    const distancia = calcularDistanciaLevenshtein(direccionBuscada, dirNormal);
    return { direccion: dir, distancia };
  });

  return similitudes
    .sort((a, b) => a.distancia - b.distancia)
    .slice(0, limite)
    .map(s => s.direccion);
}

function verificarDireccion(_regionNoUsar, comunaInput, direccionInput) {
  const archivoComuna = comunaInput.normalize("NFD").replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, '_');
  const rutaArchivo = path.resolve(__dirname, 'comunas', archivoComuna + '.json');
  console.log(`📂 Buscando archivo: ${rutaArchivo}`);

  if (!fs.existsSync(rutaArchivo)) {
    console.log('❌ Archivo no encontrado');
    return { error: `⚠️ No se encontró la comuna "${comunaInput}".` };
  }

  const json = JSON.parse(fs.readFileSync(rutaArchivo));
  const regionExtraida = json.region || 'Región desconocida';
  const direcciones = json.direcciones || [];
  const listaNormalizada = direcciones.map(dir => typeof dir === 'string' ? normalizarTexto(dir) : normalizarTexto(dir.direccion));

  const direccionSoloHastaNumero = direccionInput.split(/torre|depto|dpto|piso|block/i)[0].trim();
  const variantes = generarVariaciones(direccionSoloHastaNumero);

  console.log('🔄 Variantes generadas:');
  variantes.forEach(v => console.log(`→ ${v}`));

  let direccionEncontrada = null;
  const existe = variantes.some(variacion => {
    for (let i = 0; i < listaNormalizada.length; i++) {
      if (listaNormalizada[i].includes(variacion)) {
        direccionEncontrada = typeof direcciones[i] === 'string' ? direcciones[i] : direcciones[i].direccion;
        console.log(`🔍 Coincidencia encontrada: "${direccionEncontrada}"`);
        return true;
      }
    }
    return false;
  });

  if (existe) {
    const rutaArchivoJSON = path.join(__dirname, 'shared', 'direccion.json');
    fs.mkdirSync(path.dirname(rutaArchivoJSON), { recursive: true });
    fs.writeFileSync(rutaArchivoJSON, JSON.stringify({ direccion: `/factibilidad ${regionExtraida}, ${comunaInput}, ${direccionEncontrada}` }));
    console.log(`✅ Dirección guardada: /factibilidad ${regionExtraida}, ${comunaInput}, ${direccionEncontrada}`);

    return {
      ok: true,
      region: regionExtraida,
      comuna: comunaInput,
      calle: direccionEncontrada.split(' ').slice(0, -1).join(' '),
      numero: direccionEncontrada.split(' ').slice(-1)[0],
      direccion: direccionEncontrada
    };
  } else {
    const sugerencias = obtenerSugerencias(normalizarTexto(direccionInput), direcciones.map(dir => typeof dir === 'string' ? dir : dir.direccion));
    return {
      ok: false,
      mensaje: `🚫 Dirección no encontrada en ${comunaInput}.
` + (sugerencias.length ? `📌 Sugerencias:
- ${sugerencias.join('\n- ')}` : 'Sin coincidencias cercanas.')
    };
  }
}

// 🧠 Procesar dirección con GPT
async function procesarDireccionIA(texto) {
  texto = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, ' ').trim();

  const prompt = `Analiza cuidadosamente la siguiente dirección escrita libremente por un usuario.

Extrae únicamente los siguientes campos:
- comuna (obligatorio, prioridad principal)
- calle (obligatorio)
- número (obligatorio)
- región (si está explícitamente escrita en el texto, inclúyela; si no, deja "")

El texto puede venir en cualquier orden.

Importante:
- No inventes datos.
- No asumas datos.
- No completes región, comuna, calle o número si no están explícitos.
- Si no puedes encontrar comuna, calle o número, responde únicamente:
{ "error": "No se pudo interpretar correctamente la dirección" }

Devuelve siempre un JSON con este formato estricto:
{ "region": "...", "comuna": "...", "calle": "...", "numero": "..." }

Dirección: "${texto}"`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    });
    return JSON.parse(completion.choices[0].message.content);
  } catch (e) {
    console.error('❌ Error detallado al interpretar IA:', e);
    return { error: '❌ Error interpretando dirección con IA. Intenta nuevamente más tarde.' };
  }
}


function guardarJSONLog(data) {
  const ruta = path.join(__dirname, 'logs', `log-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(data, null, 2), 'utf8');
}

bot.command('factibilidad', async (ctx) => {
  const inputCrudo = ctx.message.text.replace('/factibilidad', '').trim();
  const partes = inputCrudo.split(',').map(p => p.trim());
  const baseDireccion = partes.slice(0, 4).join(', ');
  const parteExtra = partes.slice(4).join(', ');

  const iaResultado = await procesarDireccionIA(baseDireccion);
  if (iaResultado.error) return ctx.reply(iaResultado.error);
  if (!iaResultado.comuna) return ctx.reply('⚠️ Faltó la comuna. Revisa que esté bien escrita.');

  const resultado = await verificarDireccion(
    iaResultado.region,
    iaResultado.comuna,
    `${iaResultado.calle} ${iaResultado.numero}`
  );

// 🔵 INICIO CAMBIO
if (!resultado.ok) {
  await ctx.reply(`⚠️ Dirección no encontrada en base local. Intentando directamente en WOM...`);
} else {
  await ctx.reply(`✅ Dirección verificada: ${resultado.direccion}`);
}

guardarJSONLog({
  usuario: ctx.from,
  entrada_original: inputCrudo,
  analisis_ia: iaResultado,
  verificarDireccion: resultado,
  timestamp: new Date().toISOString()
});

const inputFinal = `${resultado.region || iaResultado.region}, ${resultado.comuna || iaResultado.comuna}, ${resultado.calle || iaResultado.calle}, ${resultado.numero || iaResultado.numero}` + (parteExtra ? `, ${parteExtra}` : '');
console.log('➡️ Input final para bot:', inputFinal);

await bot2(ctx, inputFinal);
// 🔵 FIN CAMBIO
});

bot.on('text', async (ctx) => {
  const texto = ctx.message.text.trim().toLowerCase();
  if (texto.startsWith('factibilidad')) {
    ctx.message.text = '/factibilidad' + ctx.message.text.slice('factibilidad'.length);
    return bot.handleUpdate(ctx.update);
  }
});

// 🔵 INICIO CAMBIO
bot.command('forzar', async (ctx) => {
  const input = ctx.message.text.replace('/forzar', '').trim();
  if (!input || input.split(',').length < 4) {
    return ctx.reply('⚠️ Usa el formato: /forzar Región, Comuna, Calle, Número');
  }

  await ctx.reply(`🚀 Ejecutando forzado directo con dirección:
${input}`);

  // Se elimina la verificación y se envía directo a bot2
  await bot2(ctx, input);
});
// 🔵 FIN CAMBIO

bot.launch();
console.log('🚀 Bot con IA para factibilidad iniciado.');