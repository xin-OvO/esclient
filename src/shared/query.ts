export const parseLiteralValue = (value: string): string | number | boolean | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  const unquoted = trimmed.replace(/^['"]|['"]$/g, '')
  const lower = unquoted.toLowerCase()

  if (lower === 'true') return true
  if (lower === 'false') return false
  if (lower === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(unquoted)) return Number(unquoted)

  return unquoted
}

export const splitConditionText = (
  text: string
): { parts: string[]; connectors: Array<'and' | 'or'> } => {
  const parts: string[] = []
  const connectors: Array<'and' | 'or'> = []
  let current = ''
  let quote: '"' | "'" | undefined
  let parenDepth = 0

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChunk = text.slice(index)

    if ((char === '"' || char === "'") && text[index - 1] !== '\\') {
      quote = quote === char ? undefined : quote || char
      current += char
      continue
    }

    if (!quote) {
      if (char === '(') parenDepth += 1
      if (char === ')') parenDepth = Math.max(0, parenDepth - 1)

      const connectorMatch = nextChunk.match(/^\s+(and|or)\s+/i)
      if (parenDepth === 0 && connectorMatch) {
        parts.push(current.trim())
        connectors.push(connectorMatch[1].toLowerCase() as 'and' | 'or')
        index += connectorMatch[0].length - 1
        current = ''
        continue
      }
    }

    current += char
  }

  if (current.trim()) {
    parts.push(current.trim())
  }

  return { parts, connectors }
}

export const parseConditionClause = (clause: string): Record<string, unknown> => {
  const match = clause.match(/^([\w.@-]+)\s*(>=|<=|!=|=|>|<|like|in)\s*(.+)$/i)
  if (!match) {
    throw new Error(`查询条件格式不正确：${clause}`)
  }

  const [, field, rawOperator, rawValue] = match
  const operator = rawOperator.toLowerCase()

  if (operator === 'like') {
    const value = String(parseLiteralValue(rawValue)).replace(/\*/g, '')
    return { wildcard: { [field]: `*${value}*` } }
  }

  if (operator === 'in') {
    const normalized = rawValue.trim().replace(/^\(|\)$/g, '').replace(/^\[|\]$/g, '')
    const values = normalized
      .split(',')
      .map((item) => parseLiteralValue(item))
      .filter((item) => item !== '')

    if (!values.length) {
      throw new Error(`in 查询至少需要一个值：${clause}`)
    }

    return { terms: { [field]: values } }
  }

  const value = parseLiteralValue(rawValue)

  if (operator === '=') {
    if (typeof value === 'string') {
      return { match_phrase: { [field]: value } }
    }

    return { term: { [field]: value } }
  }

  if (operator === '!=') {
    return {
      bool: {
        must_not: [
          typeof value === 'string'
            ? { match_phrase: { [field]: value } }
            : { term: { [field]: value } }
        ]
      }
    }
  }

  const rangeOperatorMap: Record<string, string> = {
    '>=': 'gte',
    '<=': 'lte',
    '>': 'gt',
    '<': 'lt'
  }

  return { range: { [field]: { [rangeOperatorMap[operator]]: value } } }
}

export const parseConditionQuery = (text: string): Record<string, unknown> => {
  const { parts, connectors } = splitConditionText(text)
  const queries = parts.map(parseConditionClause)

  if (!queries.length) {
    return { query: { match_all: {} } }
  }

  if (connectors.length && connectors.some((item) => item === 'or')) {
    const groups: Array<Record<string, unknown>[]> = [[]]

    queries.forEach((query, index) => {
      groups[groups.length - 1].push(query)
      if (connectors[index] === 'or') {
        groups.push([])
      }
    })

    const should = groups
      .filter((group) => group.length)
      .map((group) => (group.length === 1 ? group[0] : { bool: { must: group } }))

    return { query: { bool: { should, minimum_should_match: 1 } } }
  }

  return { query: { bool: { must: queries } } }
}

export const formatConditionDsl = (text: string): string => {
  return JSON.stringify(parseConditionQuery(text), null, 2)
}

export const parseSearchBody = (text?: string): Record<string, unknown> => {
  if (!text?.trim()) {
    return { query: { match_all: {} } }
  }

  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) {
    return parseConditionQuery(trimmed)
  }

  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON 查询必须是对象')
  }

  return parsed as Record<string, unknown>
}
