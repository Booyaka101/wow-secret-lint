-- Patch 12.0.0 API changes: "COMBAT_LOG_EVENT and COMBAT_LOG_EVENT_UNFILTERED will error
-- when trying to register them."
local frame = CreateFrame("Frame")
frame:RegisterEvent("COMBAT_LOG_EVENT_UNFILTERED")
frame:RegisterEvent("COMBAT_LOG_EVENT")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("COMBAT_LOG_EVENT_INTERNAL_UNFILTERED")
