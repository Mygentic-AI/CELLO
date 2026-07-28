terraform {
  required_version = ">= 1.9"

  backend "gcs" {
    bucket = "cello-infra-tfstate"
    prefix = "cello-infra"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.project_id
}
