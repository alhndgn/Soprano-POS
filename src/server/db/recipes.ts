import { db } from './client.ts'

/**
 * Pizza ürünlerine varsayılan içerik listesi ve açıklama ekler.
 * Sadece hiç içerik kaydı yoksa çalışır (mevcut kurulumu bozmaz).
 */

type Ing = [name: string, price: number, included: boolean]

const RECIPES: Record<string, { description: string; ingredients: Ing[] }> = {
  Margarita: {
    description:
      'İnce açılmış el yapımı hamur üzerine ev yapımı domates sosu, taze mozzarella ve fesleğen. Taş fırında 380°C’de 3 dakika pişirilir; kenarları kabarcıklı, içi yumuşak kalır.',
    ingredients: [
      ['Domates sosu', 0, true],
      ['Mozzarella', 0, true],
      ['Fesleğen', 0, true],
      ['Ekstra mozzarella', 3000, false],
      ['Zeytinyağı', 0, true],
    ],
  },
  'Soprano Special': {
    description:
      'Soprano’nun imza pizzası: domates sosu, mozzarella, sucuk, sosis, mantar, mısır ve zeytin. Malzemeler hamurun üzerine sırayla yerleştirilir, son olarak kaşar rendesi eklenir.',
    ingredients: [
      ['Domates sosu', 0, true],
      ['Mozzarella', 0, true],
      ['Sucuk', 0, true],
      ['Sosis', 0, true],
      ['Mantar', 0, true],
      ['Mısır', 0, true],
      ['Zeytin', 0, true],
      ['Ekstra kaşar', 2500, false],
      ['Jalapeno', 2000, false],
    ],
  },
  Pepperoni: {
    description:
      'Bol pepperoni, mozzarella ve domates sosu. Pepperoni dilimleri hamurun üzerine tek sıra halinde dizilir; fırında kenarları kıvrılır ve yağı pizzaya yayılır.',
    ingredients: [
      ['Domates sosu', 0, true],
      ['Mozzarella', 0, true],
      ['Pepperoni', 0, true],
      ['Ekstra pepperoni', 3500, false],
      ['Acı sos', 1000, false],
    ],
  },
  'Dört Peynirli': {
    description:
      'Mozzarella, kaşar, gorgonzola ve parmesan. Dört peynir hamurun üzerine katman katman serpilir, üzerine bir tutam karabiber eklenir.',
    ingredients: [
      ['Mozzarella', 0, true],
      ['Kaşar', 0, true],
      ['Gorgonzola', 0, true],
      ['Parmesan', 0, true],
      ['Ekstra kaşar', 2500, false],
      ['Ceviz', 1500, false],
    ],
  },
  Vejetaryen: {
    description:
      'Domates sosu, mozzarella, mantar, biber, soğan, mısır ve zeytin. Et içermez; sebzeler her sabah taze doğranır.',
    ingredients: [
      ['Domates sosu', 0, true],
      ['Mozzarella', 0, true],
      ['Mantar', 0, true],
      ['Biber', 0, true],
      ['Soğan', 0, true],
      ['Mısır', 0, true],
      ['Zeytin', 0, true],
      ['Ekstra sebze', 2000, false],
    ],
  },
  'BBQ Tavuk': {
    description:
      'Barbekü soslu tavuk parçaları, mozzarella, kırmızı soğan ve mısır. Tavuk göğsü önceden marine edilip ızgarada pişirilir, sonra pizza üzerine yerleştirilir.',
    ingredients: [
      ['BBQ sos', 0, true],
      ['Mozzarella', 0, true],
      ['Tavuk', 0, true],
      ['Kırmızı soğan', 0, true],
      ['Mısır', 0, true],
      ['Ekstra tavuk', 4000, false],
      ['Jalapeno', 2000, false],
    ],
  },
  'Sarımsaklı Ekmek': {
    description:
      'Fırından yeni çıkmış pizza hamuru üzerine sarımsaklı tereyağı ve maydanoz. 4 dilim olarak servis edilir.',
    ingredients: [
      ['Tereyağı', 0, true],
      ['Sarımsak', 0, true],
      ['Maydanoz', 0, true],
      ['Kaşar', 2000, false],
    ],
  },
  'Sezar Salata': {
    description:
      'Marul, kruton, parmesan ve sezar sos. Tavuk eklemek isterseniz belirtin.',
    ingredients: [
      ['Marul', 0, true],
      ['Kruton', 0, true],
      ['Parmesan', 0, true],
      ['Sezar sos', 0, true],
      ['Izgara tavuk', 4000, false],
    ],
  },
}

/** İçeriği olan ürünlerde "Ek Malzeme" modifier grubu tekrar yaratmasın diye bir kez ayırır. */
async function dedupeExtras() {
  const flag = await db.one<{ value: any }>(`SELECT value FROM settings WHERE key='migr:ekmalzeme-v1'`)
  if (flag) return
  await db.all(
    `DELETE FROM product_modifier_groups pmg
     USING modifier_groups g
     WHERE pmg.group_id = g.id AND g.name = 'Ek Malzeme'
       AND EXISTS (
         SELECT 1 FROM product_ingredients pi
         WHERE pi.product_id = pmg.product_id AND pi.active = true AND pi.included = false AND pi.price > 0
       )`,
  )
  await db.one(`INSERT INTO settings (key, value) VALUES ('migr:ekmalzeme-v1', 'true'::jsonb) RETURNING key`)
}

export async function ensureRecipes(): Promise<{ products: number; ingredients: number }> {
  await dedupeExtras()
  const existing = await db.one<{ c: number }>(`SELECT count(*)::int AS c FROM product_ingredients`)
  if (existing && existing.c > 0) return { products: 0, ingredients: 0 }

  const products = await db.all<{ id: number; name: string; description: string | null }>(
    `SELECT id, name, description FROM products WHERE active = true`,
  )
  let touched = 0
  let ing = 0

  for (const p of products) {
    const recipe = RECIPES[p.name]
    if (!recipe) continue
    if (!p.description) {
      await db.one(`UPDATE products SET description=$1 WHERE id=$2 RETURNING id`, [recipe.description, p.id])
    }
    let sort = 0
    for (const [name, price, included] of recipe.ingredients) {
      await db.one(
        `INSERT INTO product_ingredients (product_id, name, price, included, sort) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [p.id, name, price, included, sort++],
      )
      ing++
    }
    touched++
  }
  return { products: touched, ingredients: ing }
}
