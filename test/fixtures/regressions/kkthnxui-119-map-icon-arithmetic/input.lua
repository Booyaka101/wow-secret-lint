-- Shape reconstructed from Kkthnx-Wow/KkthnxUI#119 (CDNDream, 2026-08-22), the same
-- Blizzard_UIWidgetTemplateTextWithState.lua:35 arithmetic trace reached through the
-- map-icon path. Here the secret is stored on a table first, then read back.
local Module = {}

function Module:UpdateAreaPOI(icon, unit)
	self.cache = {}
	self.cache.textHeight = UnitHealthMissing(unit)
	icon:SetHeight(self.cache.textHeight - 4)
end

return Module
