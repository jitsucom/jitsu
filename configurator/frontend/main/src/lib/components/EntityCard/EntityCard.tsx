import { Card } from "antd"
import React from "react"
import { Link } from "react-router-dom"
import ProjectLink from "../ProjectLink/ProjectLink"
import styles from "./EntityCard.module.less"

type EntityCardProps = {
  name: string | React.ReactNode
  message?: React.ReactNode
  size?: "small" | "default"
  icon: React.ReactNode
  onMouseEnter?: (...args: unknown[]) => void
  onMouseLeave?: (...args: unknown[]) => void
}

const EntityCard: React.FC<EntityCardProps> = ({ name, message, size = "small", icon, onMouseEnter, onMouseLeave }) => (
  <div className={`${styles.link} w-full`} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
    <Card size={size} bordered={false}>
      <Card.Meta title={<EntityCardTitle>{name}</EntityCardTitle>} avatar={icon} description={message} />
    </Card>
  </div>
)

const EntityCardTitle: React.FC = ({ children }) => {
  return <div className="mt-2">{children}</div>
}

const EntityCardLink: React.FC<EntityCardProps & { link?: string }> = ({ link, ...entityCardProps }) => {
  return link ? (
    <ProjectLink to={link} className="w-full">
      <EntityCard {...entityCardProps} />
    </ProjectLink>
  ) : (
    <EntityCard {...entityCardProps} />
  )
}

export { EntityCardLink as EntityCard }
