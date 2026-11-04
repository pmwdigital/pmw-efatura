# @pmwdigital/efatura

e-Fatura ve e-Arşiv fatura XML'ini (UBL-TR) XSLT kullanmadan okur. Fatura numarası, ETTN, tarihler, satıcı ve alıcı, kalemler, iskontolar, KDV dökümü ve toplamlar düz bir JavaScript nesnesi olarak gelir. Okurken kalemlerin faturanın kendi toplamlarıyla tutup tutmadığına da bakar.

Bağımlılığı yoktur. Tarayıcıda yerleşik `DOMParser` ile, Node'da `@xmldom/xmldom` gibi bir `DOMParser` ile çalışır. TypeScript ile yazılmıştır, ESM olarak dağıtılır.

## Neden şimdi

e-Fatura XML'i, faturanın resmi görüntüsünü çizen XSLT dosyasını genellikle içinde taşır. Chrome, XSLT desteğini 17 Kasım 2026'da kaldırıyor ([Chrome duyurusu](https://developer.chrome.com/docs/web-platform/deprecating-xslt)). Faturayı tarayıcıda bu XSLT ile çizen görüntüleyiciler o tarihten sonra Chrome'da çalışmaz.

Bu kütüphane XSLT kullanmaz. Veriyi doğrudan XML'den okur; faturayı kendi arayüzünüzle gösterirsiniz.

## Kurulum

```bash
npm install github:pmwdigital/pmw-efatura
```

## Tarayıcıda

```ts
import { parseUblInvoice } from "@pmwdigital/efatura";

const result = parseUblInvoice(await file.text());

if (result.ok) {
    console.log(result.invoice.number, result.invoice.totals.payable);
} else {
    console.log(result.reason);
}
```

`file`, bir `<input type="file">` alanında seçilen dosyadır. Dosya okunamazsa fonksiyon hata fırlatmaz; `ok: false` ile birlikte Türkçe bir `reason` döner.

## Node'da

Node'da yerleşik `DOMParser` yoktur. `@xmldom/xmldom` gibi bir `DOMParser` örneğini ikinci parametre olarak verin:

```bash
npm install @xmldom/xmldom
```

```ts
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { parseUblInvoice } from "@pmwdigital/efatura";

const result = parseUblInvoice(readFileSync("fatura.xml", "utf8"), new DOMParser());
```

İkinci parametre verilmezse ve ortamda `DOMParser` yoksa fonksiyon, ne yapılacağını söyleyen bir hata fırlatır.

## Ne döner

Depodaki örnek fatura ([`src/fixtures/ornek-fatura.xml`](src/fixtures/ornek-fatura.xml)) için `result.invoice` şudur. Dört kalemden yalnız ilki gösteriliyor:

```ts
{
    number: "ORN2026000000042",
    ettn: "ff0afb9c-74a4-4e2f-81db-b1f1e4da1799",
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    profile: "TICARIFATURA",
    invoiceType: "SATIS",
    currency: "TRY",
    supplier: { name: "Örnek Gıda Ltd. Şti.", taxId: "9876543217", taxOffice: "Deneme" },
    customer: { name: "Deneme Ticaret A.Ş.", taxId: "1234567890", taxOffice: "Örnek" },
    lines: [
        {
            name: "Domates salçası 830 g",
            code: "ORN-001",
            barcode: null,
            quantity: 2,
            unitCode: "BX",
            unit: "Kutu",
            unitPrice: 840,
            grossTotal: 1680,
            discounts: [
                { rate: 8.33, amount: 139.94 },
                { rate: 20, amount: 308.01 },
            ],
            lineTotal: 1232.05,
            vatRate: 1,
            vatAmount: 12.32,
        },
    ],
    review: [],
    skipped: [],
    vatGroups: [
        { rate: 1, base: 2771.05, amount: 27.71 },
        { rate: 20, base: 1477.46, amount: 295.49 },
    ],
    totals: {
        goods: 4956.9,
        discount: 708.39,
        surcharge: null,
        subtotal: 4248.51,
        vat: 323.2,
        otherTax: null,
        withholding: null,
        taxIncluded: 4571.71,
        payable: 4571.71,
    },
    linesMatchTotals: true,
    vatChecked: true,
}
```

| Alan | İçerik |
| --- | --- |
| `number` | Fatura numarası |
| `ettn` | ETTN, küçük harfle; UUID biçiminde değilse `null` |
| `issueDate`, `dueDate` | Düzenleme tarihi ve son ödeme tarihi, `YYYY-AA-GG` |
| `profile` | Senaryo: `TEMELFATURA`, `TICARIFATURA`, `EARSIVFATURA` gibi |
| `invoiceType` | Fatura tipi: `SATIS`, `IADE`, `TEVKIFAT` gibi |
| `currency` | Para birimi kodu: `TRY`, `USD` gibi |
| `supplier`, `customer` | Satıcı ve alıcının adı, VKN ya da TCKN'si, vergi dairesi |
| `lines` | Tutarı tutan kalemler |
| `review` | Kontrol edilmesi gereken kalemler ve nedenleri |
| `skipped` | Adı okunamayan ya da tutarı eksi olan kalemler |
| `vatGroups` | KDV dökümü: oran başına matrah ve KDV tutarı |
| `totals` | Faturada yazan toplamlar; yazmayan alan `null` |
| `linesMatchTotals` | Kalemler toplamlarla tutuyor mu; karşılaştırılacak toplam yoksa `null` |
| `vatChecked` | KDV dökümü kalemlerle karşılaştırılabildi mi |

`unit`, birim kodunun okunur adıdır (`C62` için Adet, `KGM` için Kg). Bilinmeyen kod olduğu gibi kalır. İade faturası ve döviz faturası da okunur; ne yapılacağına siz karar verirsiniz.

`totals` alanlarının XML'deki karşılığı:

| Alan | XML'deki karşılığı |
| --- | --- |
| `goods` | `LineExtensionAmount`, mal hizmet toplamı |
| `discount` | `AllowanceTotalAmount`, toplam iskonto |
| `surcharge` | `ChargeTotalAmount`, toplam artırım |
| `subtotal` | `TaxExclusiveAmount`, vergiler hariç tutar |
| `taxIncluded` | `TaxInclusiveAmount`, vergiler dahil tutar |
| `payable` | `PayableAmount`, ödenecek tutar |
| `vat` | Belge düzeyindeki KDV alt toplamlarının toplamı |
| `otherTax` | ÖTV gibi KDV dışındaki vergilerin toplamı |
| `withholding` | `WithholdingTaxTotal`, KDV tevkifatı |

İlk altı alan `LegalMonetaryTotal` altından okunur.

## Kontroller

- Her kalemde miktar ile birim fiyatın çarpımından iskontolar düşülünce satır tutarı çıkmalı. Birim fiyat yazılı hanesine yuvarlanmış olabileceği için adet başına son hanenin yarısı kadar pay bırakılır. Tutmayan kalem nedeniyle birlikte `review` listesine düşer.
- Kalemlerin toplamı vergiler hariç tutarı ya da mal hizmet toplamını tutmalı. Her KDV oranında kalemlerin toplamı matrahı, matrahın oranla çarpımı da KDV tutarını vermeli. Vergiler eklenip tevkifat düşülünce ödenecek tutar çıkmalı. Kuruş farkları için kalem başına yaklaşık bir kuruş pay bırakılır. Sonuç `linesMatchTotals` alanındadır.
- İskontoda tutar esastır, yazılı yüzde yuvarlanmış olabilir. Yüzde `MultiplierFactorNumeric` içinde oran (0,0833) ya da yüzde (8,33) olarak yazılabiliyor; hangisi olduğu tutarın matraha bölümünden anlaşılır.
- Artırım, eksi tutarlı bir iskonto kademesi olarak gelir. Böylece brüt tutardan kademeler düşülünce yine satır tutarı çıkar.
- Fatura altı iskonto, her KDV oranı içinde kalemlere net tutarları oranında dağıtılır ve `invoiceShare: true` ile işaretlenir. Bu kalemlerde `lineTotal`, payı düşülmüş tutardır. Bedelsiz kalemler pay almaz.
- ÖTV gibi KDV dışındaki vergiler KDV dökümüne girmez, ödenecek tutar kontrolünde hesaba katılır.

## Dosya güvenliği

- Belge tanımı (DOCTYPE ya da ENTITY) içeren XML okunmaz. e-Fatura'da belge tanımı kullanılmaz; kötü niyetli bir tanım ise küçük bir dosyayı bellekte çok büyük bir metne çevirebilir.
- GİB zarfı (`StandardBusinessDocument`) içindeki tek fatura okunur. Dosyada birden fazla fatura varsa okunmaz.
- e-İrsaliye, fatura olmayan, kalemsiz ve bozuk XML açık bir Türkçe mesajla geri çevrilir. Mesajlar `XML_UNSAFE_MESSAGE`, `XML_UNREADABLE_MESSAGE` gibi sabitlerle dışa açıktır.
- Dosyanın başındaki UTF-8 BOM işareti atılır. Node'da `readFileSync` bu işareti silmez.

## Sınırlar

- Faturanın resmi görüntüsünü çizmez; veriyi verir, görünümü siz kurarsınız.
- e-İmzayı doğrulamaz. Faturanın gerçekten satıcıdan geldiğini ve değiştirilmediğini söylemez.
- Bir dosyada yalnız bir fatura okur.
- VKN ve TCKN'nin kontrol hanesine bakmaz; XML'de ne yazıyorsa onu verir.
- Dosya boyutuna sınır koymaz. Sunucuda kullanıyorsanız dosyayı okumadan önce boyutunu siz sınırlayın.

## Geliştirme

```bash
npm install
npm test
npm run typecheck
npm run build
```

Kapsam 19 testtir ve testler Node'da `@xmldom/xmldom` ile çalışır. Örnek faturadaki firma adları, numaralar ve tutarlar uydurmadır. VKN'ler kontrol hanesi tutacak biçimde üretilmiştir, TCKN `10000000146` yayımlanmış bir örnektir, barkod mağaza içi kullanıma ayrılmış 200 önekini taşır.

## Lisans

MIT
