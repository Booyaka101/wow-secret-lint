local hp = UnitHealth('player')
local pct = math.clamp(hp, 0, 1)
local name = C_Intl.ToUpper(UnitSpellTargetName('target'))
if string.startswith(UnitSpellTargetName('target'), 'A') then end
