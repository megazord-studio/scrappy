# Field Descriptions

Field descriptions are the most important part of a schema. The agent reads them during every extraction call to decide what value belongs in each field.

## Writing good descriptions

### Be explicit about format

```typescript
// Bad
interestRate: "The interest rate"

// Good
interestRate: "Annual interest rate as shown by the provider (e.g. '0.75%' or '0.39%–0.45%' for tiered rates). Use the provider's exact notation."
```

### Clarify what NOT to include

```typescript
// Good — prevents comparison site URLs from leaking in
url: "Direct URL to the official provider product page (not a comparison site URL)"

// Good — prevents legal suffixes
providerName: "Common short name of the bank without legal suffixes (e.g. 'UBS' not 'UBS AG', 'Migros Bank' not 'Migros Bank AG')"
```

### Describe the field's scope

```typescript
// Good — tells the agent when to use a range vs a single value
interestRate: "Annual interest rate. Use a single value like '0.75%' if there is one rate. Use a range like '0.39%–0.45%' if the rate varies by balance tier. Do NOT create separate records per tier."
```

## Naming rules

`namingRules` is a separate array of strings appended to the `extract_structured_data` tool description. Use it for cross-field consistency rules:

```typescript
namingRules: [
  "kontoName: use the EXACT official product name as shown on the provider's own website — not the comparison site's label",
  "bankName: use the bank's common short name without legal suffixes",
]
```

## Tracked fields

Fields listed in `rateFields` are the ones the update command will try to refresh. They should be described as precisely as possible because the BM25 query is built from their descriptions.

If the description is too generic (e.g. just `"rate"`), the BM25 filter may return irrelevant page sections and extraction will fail.
