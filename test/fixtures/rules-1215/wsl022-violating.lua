-- C_Intl.Transliterate refuses Null and Remove transliterators for secret text (12.1.5).
local name = UnitSpellTargetName('target')

local blank = C_Intl.Transliterate(name, 'Any-Null')
local stripped = C_Intl.Transliterate(name, 'NFD; [:Nonspacing Mark:] Remove; NFC')
local filtered = C_Intl.Transliterate(name, '[[:Mn:][:Me:]] Remove')

local STRIP = 'any-remove'
local viaLocal = C_Intl.Transliterate(name, STRIP)
local direct = C_Intl.Transliterate(UnitSpellTargetName('focus'), "Latin-ASCII; Any-Null/Variant")
