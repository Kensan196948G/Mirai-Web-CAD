variable "enable_management" {
  description = "Existing resources are managed only after import. Keep false during initial inspection."
  type        = bool
  default     = false
}

variable "account_id" {
  description = "Cloudflare account ID."
  type        = string
  default     = "4f1e888469df7e0b896bb4e211b12633"

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "account_id must be a 32-character lowercase hexadecimal ID."
  }
}

variable "zone_id" {
  description = "Cloudflare zone ID for mirai-dx-platform.com."
  type        = string
  default     = "e375e651e49a40801a305b89e297bff0"

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.zone_id))
    error_message = "zone_id must be a 32-character lowercase hexadecimal ID."
  }
}

variable "tunnel_id" {
  description = "Existing locally managed mirai-web-cad tunnel UUID."
  type        = string
  default     = "f8c9fb57-fb21-4a24-b1be-f7dd5699badc"

  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.tunnel_id))
    error_message = "tunnel_id must be a lowercase UUID."
  }
}

variable "mvp_allowed_email" {
  description = "The only human identity allowed to access the MVP application."
  type        = string
  default     = "kensan1969@gmail.com"

  validation {
    condition     = lower(trimspace(var.mvp_allowed_email)) == "kensan1969@gmail.com"
    error_message = "MVP access must remain restricted to kensan1969@gmail.com."
  }
}

variable "mvp_access_application_id" {
  description = "Existing MVP Access application UUID, used by imports.tf after inventory."
  type        = string
  default     = ""
}

variable "mvp_dns_record_id" {
  description = "Existing MVP CNAME record ID, used by imports.tf after inventory."
  type        = string
  default     = ""
}

variable "production_dns_record_id" {
  description = "Existing production CNAME record ID, used by imports.tf after inventory."
  type        = string
  default     = ""
}
