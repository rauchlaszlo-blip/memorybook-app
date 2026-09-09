from pathlib import Path

purchase_path = Path('src/PurchasePage.tsx')
purchase = purchase_path.read_text(encoding='utf-8')

purchase = purchase.replace(
"const [billingCountry, setBillingCountry] = useState('Magyarország');",
"const [billingCountry, setBillingCountry] = useState('HU');",
1,
)

country_anchor = """function countryLabel(code: string, language: string): string {\n  try {\n    const displayNames = new (Intl as any).DisplayNames([language], { type: 'region' });\n    return String(displayNames.of(code) || code);\n  } catch {\n    return code;\n  }\n}\n"""
country_insert = country_anchor + """\nfunction parseCompanyLookupAddress(rawAddress: string, country: string): {\n  postalCode?: string;\n  city?: string;\n  address?: string;\n} {\n  const normalized = rawAddress.replace(/\\r/g, '').trim();\n  if (!normalized) return {};\n\n  const lines = normalized\n    .split('\\n')\n    .map((line) => line.trim())\n    .filter(Boolean);\n\n  if (isHungarianCountry(country)) {\n    for (let index = 0; index < lines.length; index += 1) {\n      const match = lines[index].match(/^(\\d{4})\\s+(.+)$/);\n      if (!match) continue;\n      const street = lines.filter((_, lineIndex) => lineIndex !== index).join(', ').trim();\n      return {\n        postalCode: match[1],\n        city: match[2].replace(/[;,]+$/, '').trim(),\n        address: street || undefined,\n      };\n    }\n\n    const postalThenStreet = normalized.match(/^(\\d{4})\\s+([^,;]+)[,;]\\s*(.+)$/);\n    if (postalThenStreet) {\n      return {\n        postalCode: postalThenStreet[1],\n        city: postalThenStreet[2].trim(),\n        address: postalThenStreet[3].trim(),\n      };\n    }\n\n    const streetThenPostal = normalized.match(/^(.+?)[,;]\\s*(\\d{4})\\s+([^,;]+)$/);\n    if (streetThenPostal) {\n      return {\n        postalCode: streetThenPostal[2],\n        city: streetThenPostal[3].trim(),\n        address: streetThenPostal[1].trim(),\n      };\n    }\n  }\n\n  return { address: lines.join(', ') };\n}\n"""
if country_anchor not in purchase:
    raise SystemExit('countryLabel anchor not found')
purchase = purchase.replace(country_anchor, country_insert, 1)

purchase = purchase.replace(
"""  useEffect(() => {\n    if (!user) return;\n""",
"""  useEffect(() => {\n    if (!user || mode === 'organization') return;\n""",
1,
)
purchase = purchase.replace("  }, [user]);", "  }, [user, mode]);", 1)

old_lookup = """          const companyName = String(data?.companyName || '').trim();\n          if (companyName) {\n            setBillingCompanyName(companyName);\n            setCompanyLookupStatus('found');\n          } else {\n            setCompanyLookupStatus('not-found');\n          }"""
new_lookup = """          const companyName = String(data?.companyName || '').trim();\n          const companyAddress = String(data?.address || '').trim();\n          if (companyName) setBillingCompanyName(companyName);\n          if (companyAddress) {\n            const parsedAddress = parseCompanyLookupAddress(companyAddress, billingCountry);\n            if (parsedAddress.postalCode) setBillingPostalCode(parsedAddress.postalCode);\n            if (parsedAddress.city) setBillingCity(parsedAddress.city);\n            if (parsedAddress.address) setBillingAddress(parsedAddress.address);\n          }\n          if (companyName || companyAddress) {\n            setCompanyLookupStatus('found');\n          } else {\n            setCompanyLookupStatus('not-found');\n          }"""
if old_lookup not in purchase:
    raise SystemExit('company lookup target not found')
purchase = purchase.replace(old_lookup, new_lookup, 1)

purchase = purchase.replace(
"A cégnév automatikusan kitöltve a VIES adatai alapján.",
"A cég neve és a rendelkezésre álló címadatok automatikusan kitöltve a VIES adatai alapján.",
1,
)
purchase_path.write_text(purchase, encoding='utf-8')

ui_path = Path('src/publicUiI18n.ts')
ui = ui_path.read_text(encoding='utf-8')
ui = ui.replace(
"  'A cégnév automatikusan kitöltve a VIES adatai alapján.': { en: 'Company name filled automatically from VIES data.', de: 'Firmenname wurde automatisch aus VIES-Daten ausgefüllt.' },",
"  'A cég neve és a rendelkezésre álló címadatok automatikusan kitöltve a VIES adatai alapján.': { en: 'Company name and available address details were filled automatically from VIES data.', de: 'Firmenname und verfügbare Adressdaten wurden automatisch aus VIES-Daten ausgefüllt.' },",
1,
)
ui_path.write_text(ui, encoding='utf-8')

server_path = Path('server/index.ts')
server = server_path.read_text(encoding='utf-8')
old_server = """    const result = await pool.query(\n      `SELECT\n         billing_name AS \"billingName\",\n         billing_email AS \"billingEmail\",\n         billing_country AS \"billingCountry\",\n         billing_postal_code AS \"billingPostalCode\",\n         billing_city AS \"billingCity\",\n         billing_address AS \"billingAddress\",\n         billing_tax_number AS \"billingTaxNumber\",\n         billing_company_name AS \"billingCompanyName\",\n         updated_at AS \"updatedAt\"\n       FROM billing_profiles\n       WHERE user_id = $1`,\n      [session.user.id]\n    );\n\n    res.status(200).json({ billingProfile: result.rows[0] || null });"""
new_server = """    const personalPurchaseResult = await pool.query(\n      `SELECT\n         billing_name AS \"billingName\",\n         billing_email AS \"billingEmail\",\n         billing_country AS \"billingCountry\",\n         billing_postal_code AS \"billingPostalCode\",\n         billing_city AS \"billingCity\",\n         billing_address AS \"billingAddress\",\n         billing_tax_number AS \"billingTaxNumber\",\n         billing_company_name AS \"billingCompanyName\",\n         created_at AS \"updatedAt\"\n       FROM purchases\n       WHERE purchaser_user_id = $1\n         AND purchase_mode IN ('self', 'gift')\n       ORDER BY created_at DESC\n       LIMIT 1`,\n      [session.user.id]\n    );\n\n    if (personalPurchaseResult.rowCount > 0) {\n      res.status(200).json({ billingProfile: personalPurchaseResult.rows[0] });\n      return;\n    }\n\n    const profileResult = await pool.query(\n      `SELECT\n         billing_name AS \"billingName\",\n         billing_email AS \"billingEmail\",\n         billing_country AS \"billingCountry\",\n         billing_postal_code AS \"billingPostalCode\",\n         billing_city AS \"billingCity\",\n         billing_address AS \"billingAddress\",\n         billing_tax_number AS \"billingTaxNumber\",\n         billing_company_name AS \"billingCompanyName\",\n         updated_at AS \"updatedAt\"\n       FROM billing_profiles\n       WHERE user_id = $1`,\n      [session.user.id]\n    );\n\n    res.status(200).json({ billingProfile: profileResult.rows[0] || null });"""
if old_server not in server:
    raise SystemExit('billing profile endpoint target not found')
server = server.replace(old_server, new_server, 1)
server_path.write_text(server, encoding='utf-8')
