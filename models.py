from sqlalchemy import Column, String, Integer, Numeric, Date
from database import Base


class SpecificationMaterialExplosion(Base):
    """Готовая продукция (упаковка, тара, ТМЦ)"""
    __tablename__ = "specification_material_explosion"

    BOM_ITEM = Column(String, primary_key=True)
    BOM_PROD_KST_NR = Column(Integer)
    BOM_VAR = Column(Integer)
    BOM_NAME = Column(String)
    BOM_ANL_DATUM = Column(Date)
    BOM_UPD_DATUM = Column(Date)
    COMP_ITEM = Column(String, primary_key=True)
    SY0012_HOST_ART_NR = Column(String)
    COMP_NAME = Column(String)
    Type_Art = Column(String)
    COMP_BYPROD = Column(Integer)
    SY0012_EK_ME = Column(String)
    COM_PU_ONE = Column(Numeric)
    COMP_EK_KGME = Column(Numeric)
    COMP_QNT = Column(Numeric)
    COMP_EXPLOSION = Column(Integer)
    COMP_WITHDRAWAL = Column(Numeric)


class SpecificationMaterialExplosionPf(Base):
    """Полуфабрикаты (сырьё, вложенные ПФ)"""
    __tablename__ = "specification_material_explosion_pf"

    BOM_ITEM = Column(String, primary_key=True)
    BOM_PROD_KST_NR = Column(Integer)
    BOM_VAR = Column(Integer)
    BOM_NAME = Column(String)
    BOM_ANL_DATUM = Column(Date)
    BOM_UPD_DATUM = Column(Date)
    COMP_ITEM = Column(String, primary_key=True)
    SY0012_HOST_ART_NR = Column(String)
    COMP_NAME = Column(String)
    Type_Art = Column(String)
    COMP_BYPROD = Column(Integer)
    SY0012_EK_ME = Column(String)
    COM_PU_ONE = Column(Numeric)
    COMP_EK_KGME = Column(Numeric)
    COMP_QNT = Column(Numeric)
    COMP_EXPLOSION = Column(Integer)
    COMP_WITHDRAWAL = Column(Numeric)