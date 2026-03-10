from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import CatalogBase


class Supplier(CatalogBase):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    iva_included_default: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    price_lists: Mapped[list["PriceList"]] = relationship(back_populates="supplier")


class PriceList(CatalogBase):
    __tablename__ = "price_lists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    source_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    supplier: Mapped["Supplier"] = relationship(back_populates="price_lists")
    products: Mapped[list["Product"]] = relationship(back_populates="price_list")


class Product(CatalogBase):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("price_list_id", "sku", name="uq_product_pricelist_sku"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    price_list_id: Mapped[int] = mapped_column(ForeignKey("price_lists.id"), nullable=False)
    sku: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    unit: Mapped[str] = mapped_column(String(10), default="PZA", nullable=False)
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)

    price_list: Mapped["PriceList"] = relationship(back_populates="products")
    tiers: Mapped[list["PriceTier"]] = relationship(back_populates="product")
    container_offer: Mapped["ContainerOffer | None"] = relationship(back_populates="product", uselist=False)


class PriceTier(CatalogBase):
    __tablename__ = "price_tiers"
    __table_args__ = (UniqueConstraint("price_list_id", "product_id", "min_qty", name="uq_tier_product_minqty"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    price_list_id: Mapped[int] = mapped_column(ForeignKey("price_lists.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    min_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(30), nullable=False)
    unit_price: Mapped[float] = mapped_column(Float, nullable=False)

    product: Mapped["Product"] = relationship(back_populates="tiers")


class ContainerOffer(CatalogBase):
    __tablename__ = "container_offers"
    __table_args__ = (UniqueConstraint("price_list_id", "product_id", name="uq_container_offer_product"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    price_list_id: Mapped[int] = mapped_column(ForeignKey("price_lists.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    container_qty: Mapped[int] = mapped_column(Integer, nullable=False)
    container_price: Mapped[float] = mapped_column(Float, nullable=False)
    lead_time_days: Mapped[int] = mapped_column(Integer, default=45, nullable=False)
    deposit_pct: Mapped[float] = mapped_column(Float, default=0.50, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    product: Mapped["Product"] = relationship(back_populates="container_offer")


class Vendor(CatalogBase):
    __tablename__ = "vendors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    email: Mapped[str | None] = mapped_column(String(120), nullable=True)
