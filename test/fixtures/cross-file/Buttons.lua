local _, ns = ...

ns.container:RegisterEvent("PLAYER_ENTERING_WORLD")
CrossFileGlowButton:SetScript("OnShow", function() end)
CrossFileSpare:EnableMouse(true)
CrossFileGlowButton:AddPandemicEnterAnimation(ns.group)
