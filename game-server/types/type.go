package types

import "github.com/gorilla/websocket"

type Client struct {
	conn *websocket.Conn
	send chan []byte
}
type Player struct {
	id string
}
type Room struct {
	Owner   Player
	Id      string
	Players map[*Client]bool
}
