-- Mixed 12.0/12.1 surface. Under --patch=12.0 only the UnitHealth lines may report,
-- and that output is pinned byte for byte in baseline-12.0.txt (recorded with v1.2.0).
local hp = UnitHealth("player")
local pct = hp / UnitHealthMax("player") * 100

local auras = C_UnitAuras.GetUnitAuras("player")
for i = 1, #auras do
  print(auras[i].name)
end
for _, id in ipairs(C_UnitAuras.GetUnitAuraInstanceIDs("player")) do
  print(id)
end

local localizedClass, classFile = UnitClass("target")
if classFile == "MAGE" then
  print("sheep it")
end

UIParentLoadAddOn("Blizzard_TrainerUI")
local old = getglobal("MyFrame" .. 1)
setglobal("MyFlag", true)

C_UnitAuras.AddPrivateAuraAnchor({
  unitToken = "player",
  auraIndex = 1,
  parent = UIParent,
  showCountdownFrame = true,
})

local header = CreateFrame("Frame", "MyAuras", UIParent, "SecureAuraHeaderTemplate")

local container = CreateFrame("AuraContainer", nil, UIParent, "CustomAuraContainerTemplate")
container:RegisterEvent("PLAYER_ENTERING_WORLD")
container:AddAuraGroup("buffs", "HELPFUL", {
  initializeFrame = function(button)
    button:SetScript("OnShow", function() print("shown") end)
    button:EnableMouse(true)
    if button:IsMouseOver() then
      print("hover")
    end
  end,
})
