local hasMain, mainExpiry = GetWeaponEnchantInfo()
local _, bagTexture = GetInventorySlotInfo("Bag0")

return hasMain, mainExpiry, bagTexture
