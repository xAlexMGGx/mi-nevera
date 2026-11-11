# Fuentes de "Conservación y seguridad"

**Estado: PENDIENTE DE REVISIÓN por el propietario** (SPEC §9 y principio 7). Mientras `reviewed` sea `false` en `src/content/conservation/review.json`, la app lo indica en la sección y junto a los chips.

Consulta: 11/11/2026. Todo el contenido está en `guide.es.json`, `guide.en.json` (textos) y `shelf-life.json` (plazos de los chips). Cada frase y cada plazo citan una de estas fuentes. Si una cifra no tiene fuente, no se incluye.

## Fuentes usadas

| Id | Fuente | Qué aporta | Cómo se consultó |
|---|---|---|---|
| `aesan-fechas` | AESAN, [Fecha de caducidad y fecha de consumo preferente](https://aesan.gob.es/actualidad/actualidad-noticias/fechas), 16/10/2024 | Definiciones de caducidad y consumo preferente; congelar antes de que caduque; seguir las instrucciones una vez abierto | Página leída directamente |
| `aesan-apagon` | AESAN, [Alimentos del frigorífico y del congelador después del apagón](https://aesan.gob.es/actualidad/actualidad-noticias/alimentos_refrigerados), 29/04/2025 | Volver a congelar solo lo no descongelado del todo y sin pasar de 5 °C; desechar si no se sabe cuánto tiempo estuvo descongelado | Página leída directamente |
| `aesan-colocar` | AESAN, [Colocar los alimentos de forma segura](https://www.aesan.gob.es/AECOSAN/web/para_el_consumidor/ampliacion/colocar_segura.htm) | Temperatura ideal de refrigeración entre 0 y 5 °C; usar un termómetro | La página no se pudo leer de forma automática; la frase se tomó del extracto del buscador. **Verificar** |
| `aesan-higiene` | AESAN, [Higiene de los alimentos](https://www.aesan.gob.es/seguridad-alimentaria/higiene-alimentos) | Los establecimientos no pueden recongelar salvo alimentos transformados | Página leída directamente. Son requisitos para establecimientos, no consejos para el hogar |
| `fda-chart-2018` | FDA, [Refrigerator & Freezer Storage Chart](https://www.fda.gov/media/74435/download), marzo de 2018 | Frigorífico a 4 °C y congelador a −18 °C; congelado es seguro indefinidamente; tiempos de frigorífico y congelador por alimento | PDF leído directamente |
| `fsis-basics-2011` | USDA FSIS, [Basics for Handling Food Safely](https://www.govinfo.gov/content/pkg/GOVPUB-A110-PURL-gpo26772/pdf/GOVPUB-A110-PURL-gpo26772.pdf), revisado en junio de 2011 (copia de la imprenta del Gobierno de EE. UU.) | Regla de las 2 horas; métodos de descongelación; recongelar; sobras en 4 días; mayonesa y embutido curado | PDF leído directamente |
| `fsis-shelf-stable-2014` | USDA FSIS, [Shelf-Stable Food Safety](https://www.govinfo.gov/content/pkg/GOVPUB-A110-PURL-gpo38739/pdf/GOVPUB-A110-PURL-gpo38739.pdf), actualizado en agosto de 2014 (copia de la imprenta del Gobierno de EE. UU.) | Conservas abiertas: ácidas 5 a 7 días, poco ácidas 3 a 4; embutido curado abierto 3 semanas | PDF leído directamente |
| `fsis-big-thaw` | USDA FSIS, [The Big Thaw](https://webarchive.library.unt.edu/web/20121007115729/http://www.fsis.usda.gov/Fact_Sheets/Big_Thaw/index.asp) (copia archivada; [versión actual](https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/big-thaw-safe-defrosting-methods)) | Tras descongelar en el frigorífico: picada, aves y pescado 1 a 2 días; filetes, chuletas y asados 3 a 5 | Ni la página actual ni la archivada se pudieron leer de forma automática; el texto se tomó del extracto del buscador sobre la copia archivada. **Verificar** |

## Lo que no se ha incluido, y por qué

- **Lácteos abiertos (leche, yogur, queso, nata) y bebidas vegetales.** La fuente que los cubre, FoodKeeper (USDA), y las páginas de FoodSafety.gov y FSIS bloquean la lectura automática. Las copias de terceros no coinciden (5 días o una semana para la leche). Sin chip hasta tener una fuente revisada.
- **Fruta, verdura, pan, pasta y arroz crudos.** No aparecen en las fuentes leídas.
- **Dónde colocar cada alimento en la nevera** según la AESAN. Su página no se pudo leer de forma automática.
- **Costillas, conejo, morcilla, anchoas, aceitunas y pimientos del piquillo.** Las fuentes no los nombran, o no está claro en qué grupo entran.

## Cómo revisarlo

1. Abre cada enlace y comprueba que las frases de `guide.es.json` y los plazos de `shelf-life.json` dicen lo mismo que la fuente.
2. Corrige o quita lo que no encaje. Tras tocar `shelf-life.json`, genera una migración nueva con `npm run shelf-life:migration`.
3. Cuando esté todo revisado, pon `"reviewed": true` en `src/content/conservation/review.json`.
