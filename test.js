// Archivo de prueba manual para buscar direccion auto con comentarios explicativos
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

// Activamos el modo stealth para evitar bloqueos del sitio web por automatización
puppeteer.use(StealthPlugin());

// Función principal para buscar la dirección automáticamente en el portal
async function buscarDireccionAuto(page, ctx, region, comuna, calle, numero, torre = '', depto = '') {
  try {
    // Esperamos que esté visible el input de dirección y lo seleccionamos
    await page.waitForSelector('input#direccion', { visible: true });
    const inputs = await page.$$('input#direccion');

    // Buscamos el input visible (por si hay más de uno oculto)
    let inputDireccion;
    for (let i = 0; i < inputs.length; i++) {
      const visible = await inputs[i].evaluate(el => {
        const style = window.getComputedStyle(el);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          el.offsetHeight > 0
        );
      });
      if (visible) {
        inputDireccion = inputs[i];
        break;
      }
    }

    if (!inputDireccion) throw new Error('❌ No se encontró un input visible para escribir la dirección.');

    // Clic y escritura de los datos formateados en el input de dirección
    await inputDireccion.click();
    await page.waitForTimeout(500);
    const calleFormateada = region.trim().toUpperCase() === "LIBERTADOR BERNARDO O'HIGGINS"
      ? calle.replace(/LIBERTADOR BERNARDO O['’]HIGGINS/gi, 'LIB GRAL BERNARDO O HIGGINS')
      : calle;
    const componentesBusqueda = [calleFormateada, numero, torre, depto].filter(Boolean).join(' ');
    await inputDireccion.type(componentesBusqueda, { delay: 100 });
    await page.waitForTimeout(500);
    await inputDireccion.press('Backspace'); // gatilla sugerencias
    await page.waitForTimeout(2000);

    // Buscamos opciones desplegadas que contengan la calle ingresada
    const posiblesOpciones = await page.$x(`//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ', 'abcdefghijklmnopqrstuvwxyzáéíóú'), '${calle.toLowerCase()}')]`);
    if (ctx?.reply) await ctx.reply(`🔍 Opciones encontradas: ${posiblesOpciones.length}`);

    let opcionSeleccionada = false;
    const direccionEsperada = [region, comuna, calle, numero, torre, depto].filter(Boolean).join(', ').toUpperCase();
    console.log(`➡️ Input final para bot: ${direccionEsperada}`);
    if (ctx?.reply) await ctx.reply(`➡️ Input final para bot: ${direccionEsperada}`);

    // Recorremos opciones para encontrar coincidencia con calle y número
    for (const [index, opcion] of posiblesOpciones.entries()) {
      const texto = await page.evaluate(el => el.textContent.trim(), opcion);
      const textoUpper = texto.toUpperCase();
      const calleUpper = calle.toUpperCase();
      const numeroUpper = numero.toUpperCase();

      if (textoUpper.includes(calleUpper) && textoUpper.includes(numeroUpper)) {
        // Scroll y clic en la opción detectada
        await page.evaluate((text) => {
          const items = Array.from(document.querySelectorAll('.item-content'));
          const contenedor = document.querySelector('section.drop_down');
          const target = items.find(el => el.textContent.trim() === text);
          if (target && contenedor) contenedor.scrollTop = target.offsetTop - 100;
        }, texto);

        await opcion.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(500);

        const box = await opcion.boundingBox();
        if (box) {
          if (ctx?.reply) await ctx.reply(`🟢 Dirección exacta encontrada: ${texto}`);
          console.log(`✅ Seleccionando dirección exacta: ${texto}`);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(1000);

          // Confirmamos selección usando la lupa y luego clic en primera opción visible
          const lupa = await page.$('label.input_icon--left.icono-lupa');
          if (lupa) {
            await lupa.click();
            await page.waitForTimeout(2000);
          }

          const opcionesFinales = await page.$$('.item-content');
          if (opcionesFinales.length > 0) {
            const primeraOpcion = opcionesFinales[0];
            const boxPrimera = await primeraOpcion.boundingBox();
            if (boxPrimera) {
              console.log(`✅ Haciendo clic en la primera opción después de lupa...`);
              await page.mouse.move(boxPrimera.x + boxPrimera.width / 2, boxPrimera.y + boxPrimera.height / 2);
              await page.mouse.click(boxPrimera.x + boxPrimera.width / 2, boxPrimera.y + boxPrimera.height / 2);
              await page.waitForTimeout(1000);
            }
          }

          if (ctx?.reply) await ctx.reply('✅ Dirección completada factibilizada...');

          // Tomamos captura del resultado (modal o pantalla completa)
          try {
            await page.waitForSelector('section.modal_cnt.container-row', { visible: true, timeout: 10000 });
            await page.evaluate(() => {
              const modal = document.querySelector('section.modal_cnt.container-row');
              if (modal) modal.scrollIntoView({ block: 'center', behavior: 'smooth' });
            });
            await page.waitForTimeout(1000);
            const modal = await page.$('section.modal_cnt.container-row');
            const buffer = await modal.screenshot();
            if (ctx?.replyWithPhoto) await ctx.replyWithPhoto({ source: buffer });
            if (ctx?.reply) await ctx.reply('📸 Captura del resultado tomada correctamente.');
          } catch (e) {
            const buffer = await page.screenshot({ fullPage: true });
            if (ctx?.replyWithPhoto) await ctx.replyWithPhoto({ source: buffer });
          }

          opcionSeleccionada = true;
          break;
        }
      }
    }

    // Reintento con número antepuesto por cero si no hubo coincidencia
    if (!opcionSeleccionada) {
      if (ctx?.reply) await ctx.reply('🔄 No se encontró coincidencia exacta. Reintentando con 0 al inicio del número...');
      await inputDireccion.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(500);

      const numeroConCero = '0' + numero;
      await inputDireccion.type(`${calle} ${numeroConCero}`, { delay: 100 });
      await page.waitForTimeout(500);
      await inputDireccion.press('Backspace');
      await page.waitForTimeout(1500);

      const nuevasOpciones = await page.$x(`//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ', 'abcdefghijklmnopqrstuvwxyzáéíóú'), '${calle.toLowerCase()}')]`);
      if (ctx?.reply) await ctx.reply(`🔍 Reintento - Opciones encontradas: ${nuevasOpciones.length}`);

      for (const [index, opcion] of nuevasOpciones.entries()) {
        const texto = await page.evaluate(el => el.textContent.trim(), opcion);
        const textoUpper = texto.toUpperCase();
        const numeroUpper = numeroConCero.toUpperCase();
        const calleUpper = calle.toUpperCase();

        if (textoUpper.includes(calleUpper) && textoUpper.includes(numeroUpper)) {
          await page.evaluate((text) => {
            const items = Array.from(document.querySelectorAll('.item-content'));
            const contenedor = document.querySelector('section.drop_down');
            const target = items.find(el => el.textContent.trim() === text);
            if (target && contenedor) contenedor.scrollTop = target.offsetTop - 100;
          }, texto);

          await opcion.evaluate(el => el.scrollIntoView({ block: 'center' }));
          const box = await opcion.boundingBox();
          if (box) {
            if (ctx?.reply) await ctx.reply(`🟢 Dirección con cero encontrada: ${texto}`);
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await page.waitForTimeout(1000);
            opcionSeleccionada = true;
            break;
          }
        }
      }

      if (!opcionSeleccionada) {
        if (ctx?.reply) await ctx.reply('❌ Tampoco se encontró con número modificado. Continuando en modo manual...');
        console.log(`⚠️ Ninguna opción coincide con número 0-prefijado: ${calle} 0${numero}`);
      }
    }
  } catch (e) {
    console.error('❌ Error en la búsqueda automática:', e);
    if (ctx?.reply) await ctx.reply('⚠️ Hubo un problema en la búsqueda automática. Continuando en modo manual...');
  }
}

// Bloque de ejecución directa para pruebas locales
(async () => {
  const browser = await puppeteer.launch({ headless: false, slowMo: 30, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  try {
    await page.goto('https://sso-ocp4-sr-amp.apps.sr-ocp.wom.cl/auth/realms/customer-care/protocol/openid-connect/auth?client_id=e7c0d592&redirect_uri=https%3A%2F%2Fcustomercareapplicationservice.ose.wom.cl%2Fwomac%2Flogin&state=d213955b-7112-4036-b60d-a4b79940cde5&response_mode=fragment&response_type=code&scope=openid&nonce=43e8fbde-b45e-46db-843f-4482bbed44b2', { waitUntil: 'networkidle2' });
    await page.type('#username', process.env.WOM_USER);
    await page.type('#password', process.env.WOM_PASS);
    await Promise.all([
      page.click('#kc-login'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    await page.waitForSelector('#Button_Opcion_Top_Fact_Tec', { visible: true });
    await page.click('#Button_Opcion_Top_Fact_Tec');
    await page.waitForTimeout(1500);

    // Dirección de prueba editable
    const inputManual = {
      region: 'METROPOLITANA',
      comuna: 'SAN MIGUEL',
      calle: 'SAN PETERSBURGO',
      numero: '6351',
      torre: 'TORRE D',
      depto: '1006'
    };

    const ctxMock = {
      reply: console.log,
      replyWithPhoto: () => console.log('📸 Captura enviada')
    };

    await buscarDireccionAuto(page, ctxMock, inputManual.region, inputManual.comuna, inputManual.calle, inputManual.numero, inputManual.torre, inputManual.depto);
  } catch (e) {
    console.error('❌ Error en prueba manual:', e);
  } finally {
    await browser.close();
  }
})();

// Exportación para pruebas externas si se requiere
module.exports = { buscarDireccionAuto };
