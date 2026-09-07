-- This file's ns is its own table, not the addon's private one, and its
-- CrossFileGlowButton is a plain local frame that shadows the global.
local ns = {}
ns.container = CreateFrame("Frame")
ns.container:RegisterEvent("PLAYER_LOGIN")

local CrossFileGlowButton = CreateFrame("Button")
CrossFileGlowButton:SetScript("OnClick", function() end)
