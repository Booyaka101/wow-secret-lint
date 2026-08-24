-- Shape reconstructed from Kkthnx-Wow/KkthnxUI#118 (jochribra, 2026-08-22):
--   "...KkthnxUI/Modules/UnitFrames/Elements/Bars.lua:167: attempted to index a table that
--    cannot be indexed with secret keys" (in PostUpdateColor, via oUF health element)
local Bars = {}
local colorTable = {}

function Bars:PostUpdateColor(element, unit)
	local hp = UnitHealth(unit)
	local color = colorTable[hp]
	colorTable[hp] = color
	element:SetStatusBarColor(color)
end

return Bars
