const puppeteer = require('puppeteer-extra'); // Importa Puppeteer con soporte para plugins
const StealthPlugin = require('puppeteer-extra-plugin-stealth'); // Plugin para evitar detección como bot
require('dotenv').config(); // Carga variables de entorno desde .env

puppeteer.use(StealthPlugin()); // Aplica el plugin de stealth para evitar bloqueos en el sitio

function contieneDepartamento(texto) {
  const claves = ['TORRE', 'DEPTO', 'PISO', 'CASA', 'BLOCK', 'EDIFICIO', 'A', 'B', 'C', 'D', 'E', 'F', '1', '2', '3', '4', '5', '6'];
  return claves.some(clave => texto.toUpperCase().includes(clave));
}

async function bot2(ctx, input) {
  // 🔍 DEBUG: Log del input recibido desde gestor
  console.log('📩 Input recibido en bot2:', input);

  const [region, comuna, calle, numero, torre, depto] = input.split(',').map(x => x.trim());

  if (!region || !comuna || !calle || !numero) {
    return ctx.reply('❗ Formato incorrecto. Usa: /factibilidad Región, Comuna, Calle, Número[, Torre[, Depto]]');
  }

  ctx.reply('🔍 Consultando factibilidad técnica en MAT de WOM, un momento...');

  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

  async function tomarCapturaBuffer(page) {
    await page.waitForTimeout(1000);
    const lupa = await page.$('label.input_icon--left.icono-lupa');
    if (lupa) {
      await ctx.reply('🔎 Haciendo clic en la lupa para confirmar selección...');
      await lupa.click();
      await page.waitForTimeout(4000);
    }
    return await page.screenshot({ fullPage: true });
  }

 let browser;
try {
  browser = await puppeteer.launch({
    headless: true, // 🛡️ modo obligatorio en cloud
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ],
    defaultViewport: { width: 1366, height: 900 }
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  );


    await page.goto('https://sso-ocp4-sr-amp.apps.sr-ocp.wom.cl/auth/realms/customer-care/protocol/openid-connect/auth?client_id=e7c0d592&redirect_uri=https%3A%2F%2Fcustomercareapplicationservice.ose.wom.cl%2Fwomac%2Flogin&state=d213955b-7112-4036-b60d-a4b79940cde5&response_mode=fragment&response_type=code&scope=openid&nonce=43e8fbde-b45e-46db-843f-4482bbed44b2/', { waitUntil: 'networkidle2' });

    await page.type('#username', process.env.WOM_USER);
    await page.type('#password', process.env.WOM_PASS);
    await Promise.all([
      page.click('#kc-login'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);

    await page.waitForSelector('#Button_Opcion_Top_Fact_Tec', { visible: true });
    await page.click('#Button_Opcion_Top_Fact_Tec');
    await ctx.reply('✅ Entramos a la sección "Factibilidad Técnica"...');

    await page.waitForSelector('input#direccion', { visible: true });
    const inputDireccion = await page.$('input#direccion');
    await inputDireccion.click({ clickCount: 3 });
    await inputDireccion.press('Backspace');
    await page.waitForTimeout(500);

    const calleFormateada = region.trim().toUpperCase() === "LIBERTADOR BERNARDO O'HIGGINS"
      ? calle.replace(/LIBERTADOR BERNARDO O['’]HIGGINS/gi, 'LIB GRAL BERNARDO O HIGGINS')
      : calle;

    await inputDireccion.type(`${calleFormateada} ${numero}`, { delay: 100 });
    await page.waitForTimeout(2000);
    await inputDireccion.press('Backspace');
    await page.waitForTimeout(1500);

    const opcionesVisibles = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('ul.opciones li')).map(el => el.textContent.trim()).filter(Boolean);
    });

    let mensajeOpciones = '';
    opcionesVisibles.forEach((opcion, index) => {
      mensajeOpciones += `${index + 1}. ${opcion}\n`;
    });
    if (mensajeOpciones.length > 0) {
      await ctx.reply(`📋 Opciones desplegadas por el sistema:\n${mensajeOpciones}`);
    } else {
      await ctx.reply('⚠️ No se detectaron opciones visibles en el desplegable.');
    }

    const posiblesOpciones = await page.$x(`//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ', 'abcdefghijklmnopqrstuvwxyzáéíóú'), '${(calleFormateada + ' ' + numero).toLowerCase()}')]`);
    await ctx.reply(`🔍 Opciones encontradas: ${posiblesOpciones.length}`);

    let seleccionada = false;
    for (const opcion of posiblesOpciones) {
      const texto = await page.evaluate(el => el.textContent.trim(), opcion);
      if (texto.toUpperCase().includes(calle.toUpperCase()) && texto.toUpperCase().includes(numero.toUpperCase())) {
        const box = await opcion.boundingBox();
        if (box) {
          await ctx.reply(`🟢 Dirección encontrada: ${texto}`);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(1000);
          seleccionada = true;
          break;
        }
      }
    }

    const lupa = await page.$('label.input_icon--left.icono-lupa');
    if (lupa) {
      await ctx.reply('🔎 Confirmando la dirección con clic en la lupa...');
      await lupa.click();
      await page.waitForTimeout(2500);

      try {
        await page.waitForSelector('div.drop_down', { visible: true, timeout: 8000 });
        const opcionesExtra = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('div.drop_down .item-content')).map(el => el.textContent.trim()).filter(Boolean);
});

        if (opcionesExtra.length > 0) {
          console.log('📦 Opciones torre/depto disponibles:');
          opcionesExtra.forEach((texto, idx) => {
            console.log(`${idx + 1}. ${texto}`);
          });
        } else {
          console.log('⚠️ No se detectaron opciones adicionales tras la lupa.');
        }
      } catch (e) {
        console.warn('⌛ Panel de opciones de torre/depto no apareció a tiempo.');
        await ctx.reply('⚠️ No se detectó el segundo panel después de la lupa.');
      }
    }
//////////////////////////////////////////////////////////////////////////////////////
const sinonimosTorre = ['TORRE', 'BLOCK', 'EDIFICIO', 'PISO', 'CASA'];

const opcionesFinales = await page.$$('div.drop_down .item-content');
let opcionSeleccionada = false;

// Paso 1: Filtrar las opciones que contengan el número del depto
const opcionesFiltradas = [];
for (const opcion of opcionesFinales) {
  const texto = await page.evaluate(el => el.textContent.trim(), opcion);
  if (!texto) continue;

  if (depto && texto.includes(depto)) {
    opcionesFiltradas.push({ texto, opcion });
  }
}

// Paso 2: Evaluar coincidencia exacta de torre y score por sinónimos
let mejorScore = -1;
let mejorOpcion = null;

for (const { texto, opcion } of opcionesFiltradas) {
  let score = 0;

  // Coincidencia exacta con torre
  if (torre && texto.toUpperCase().includes(torre.toUpperCase())) {
    score += 2;
  }

  // Coincidencias con sinónimos de torre
  for (const sin of sinonimosTorre) {
    if (texto.toUpperCase().includes(sin)) {
      score += 1;
    }
  }

  console.log(`🔍 Opción: "${texto}" → Score: ${score}`);

  if (score > mejorScore) {
    mejorScore = score;
    mejorOpcion = opcion;
  }
}

// Paso 3: Seleccionar la mejor opción o fallback
// Paso 3: Seleccionar la mejor opción o fallback
if (mejorOpcion) {
  const box = await mejorOpcion.boundingBox();
  if (box) {
    await ctx.reply('✅ Selección basada en número + torre (score).');

    // 🟢 Scroll humano con simulación de movimiento real del mouse
    await page.mouse.move(0, 0); // mueve el mouse al inicio
    await page.mouse.wheel({ deltaY: box.y - 200 }); // hace scroll hacia la opción
    await page.waitForTimeout(400); // espera para simular comportamiento humano
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(800);
    opcionSeleccionada = true;
  }
}


// Paso 4: Fallback si no hay ninguna con score
if (!opcionSeleccionada && opcionesFinales.length > 0) {
  const primera = opcionesFinales[0];
  const box = await primera.boundingBox();
  if (box) {
    await ctx.reply('ℹ️ No se encontró coincidencia, seleccionando primera opción visible.');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(800);
  }
}

////////////////////////////////////////////////////////////////////////////

    // Captura final después de seleccionar torre/depto
    try {
      await page.waitForSelector('section.modal_cnt.container-row', { visible: true, timeout: 10000 });
      const modal = await page.$('section.modal_cnt.container-row');
      const buffer = await modal.screenshot();
      await ctx.replyWithPhoto({ source: buffer });
      await ctx.reply('📸 Captura del resultado tomada correctamente.');
    } catch (e) {
      log('⚠️ Modal no detectado, se tomará pantalla completa');
      const buffer = await tomarCapturaBuffer(page);
      await ctx.replyWithPhoto({ source: buffer });
    }

  } catch (e) {
    console.error('❌ Error general:', e);
    await ctx.reply('⚠️ Error inesperado. Intenta nuevamente o revisa los datos.');
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { bot2 };
