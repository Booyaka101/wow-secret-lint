-- Transliterate calls that 12.1.5 allows, or that cannot be judged statically.
local name = UnitSpellTargetName('target')

local latin = C_Intl.Transliterate(name, 'Any-Latin')
local ascii = C_Intl.Transliterate(name, 'NFD; Latin-ASCII; NFC')
local unknown = C_Intl.Transliterate(name, GetTransliteratorID())
local plain = C_Intl.Transliterate('Thrall', 'Any-Remove')
local upper = C_Intl.ToUpper(name)
